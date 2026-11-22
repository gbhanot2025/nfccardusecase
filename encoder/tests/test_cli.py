"""The operator CLI end to end, with simulated tags instead of a reader."""

import csv
from datetime import datetime, timezone

import pytest

from ntag424_encoder.batch import BatchError, read_batch
from ntag424_encoder.cli import main
from ntag424_encoder.keysource import MasterKey
from ntag_sim import DeterministicRng, SimulatedNtag424

MASTER = MasterKey(key=bytes.fromhex("000102030405060708090A0B0C0D0E0F"), version=4, key_ref="openbao:ntag424/master-key@4")
BASE = "https://tags.example.com"
CLAIM = "CLAIM-SECRET-9X7Q"


class FakeReader:
    def __init__(self, tags):
        self.tags = list(tags)
        self.removed = 0

    def wait_for_tag(self):
        return self.tags.pop(0)

    def wait_for_removal(self):
        self.removed += 1


def sim(uid_hex):
    return SimulatedNtag424(bytes.fromhex(uid_hex), DeterministicRng(uid_hex.encode()))


def write_batch(path, tag_ids):
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["batch_id", "tag_id", "public_code", "nfc_url", "qr_url", "claim_code"])
        for t in tag_ids:
            w.writerow(["b1", t, "PUB" + t[-4:], f"{BASE}/t/{t}", f"{BASE}/q/PUB{t[-4:]}", CLAIM])


def run(tmp_path, reader, answers, extra=()):
    lines = []
    answers = list(answers)
    code = main(
        [str(tmp_path / "batch.csv"), "--base-url", BASE, *extra],
        reader=reader,
        prompt=lambda _msg: answers.pop(0),
        out=lines.append,
        now=lambda: datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc),
        environ={},
        key_loader=lambda args, env: MASTER,
    )
    return code, "\n".join(lines)


def read_out(tmp_path):
    with (tmp_path / "batch.encoded.csv").open(newline="") as f:
        return list(csv.DictReader(f))


def test_encodes_a_batch_and_writes_results(tmp_path):
    write_batch(tmp_path / "batch.csv", ["tag_aaaa", "tag_bbbb"])
    reader = FakeReader([sim("04000000000001"), sim("04000000000002")])
    code, log = run(tmp_path, reader, ["ENCODE", "", ""])
    assert code == 0
    rows = read_out(tmp_path)
    assert [r["tag_id"] for r in rows] == ["tag_aaaa", "tag_bbbb"]
    assert [r["uid"] for r in rows] == ["04000000000001", "04000000000002"]
    assert {r["status"] for r in rows} == {"ok"}
    assert rows[0]["encoded_at"] == "2026-11-22T12:00:00+00:00"
    assert rows[0]["key_ref"] == MASTER.key_ref
    assert list(rows[0]) == ["tag_id", "uid", "encoded_at", "status", "key_ref"]
    # Never copies claim codes or keys anywhere.
    output_text = (tmp_path / "batch.encoded.csv").read_text()
    for text in (output_text, log):
        assert CLAIM not in text
        assert MASTER.key.hex() not in text.lower()


def test_requires_explicit_confirmation(tmp_path):
    write_batch(tmp_path / "batch.csv", ["tag_aaaa"])
    reader = FakeReader([sim("04000000000001")])
    code, log = run(tmp_path, reader, ["yes"])
    assert code == 1 and "Aborted" in log
    assert reader.tags  # never touched


def test_resumes_and_refuses_reusing_a_tag(tmp_path):
    write_batch(tmp_path / "batch.csv", ["tag_aaaa", "tag_bbbb"])
    first = sim("04000000000001")
    run(tmp_path, FakeReader([first]), ["ENCODE", "", "q"])
    # Second run: only tag_bbbb is pending. The operator taps the already-encoded tag, then a fresh one.
    code, log = run(tmp_path, FakeReader([first, sim("04000000000002")]), ["ENCODE", "", ""])
    assert code == 0
    assert "already encoded in this batch" in log
    rows = read_out(tmp_path)
    assert [(r["tag_id"], r["status"]) for r in rows] == [("tag_aaaa", "ok"), ("tag_bbbb", "ok")]


def test_records_failures_and_lets_the_operator_retry(tmp_path):
    write_batch(tmp_path / "batch.csv", ["tag_aaaa"])
    used = sim("04000000000009")
    used.keys[0] = bytes([7]) * 16  # not a blank tag
    used.access["write"] = used.access["rw"] = 0
    code, log = run(tmp_path, FakeReader([used, sim("04000000000001")]), ["ENCODE", "", ""])
    assert code == 0
    assert [r["status"] for r in read_out(tmp_path)] == ["not_blank", "ok"]


def test_skip_returns_nonzero(tmp_path):
    write_batch(tmp_path / "batch.csv", ["tag_aaaa"])
    code, _ = run(tmp_path, FakeReader([]), ["ENCODE", "s"])
    assert code == 1


def test_rejects_urls_on_another_host(tmp_path):
    with (tmp_path / "batch.csv").open("w", newline="") as f:
        f.write("batch_id,tag_id,nfc_url,claim_code\nb1,tag_aaaa,https://evil.example/t/tag_aaaa,x\n")
    code, log = run(tmp_path, FakeReader([]), [])
    assert code == 2 and "expected base URL" in log


@pytest.mark.parametrize(
    "body,error",
    [
        ("tag_id\ntag_aaaa\n", "missing columns"),
        ("tag_id,nfc_url\ntag_aaaa,https://tags.example.com/t/tag_bbbb\n", "does not end with"),
        ("tag_id,nfc_url\nbad id!,https://tags.example.com/t/x\n", "invalid tag_id"),
        (
            "tag_id,nfc_url\ntag_aaaa,https://tags.example.com/t/tag_aaaa\ntag_aaaa,https://tags.example.com/t/tag_aaaa\n",
            "duplicate",
        ),
    ],
)
def test_batch_validation(tmp_path, body, error):
    path = tmp_path / "b.csv"
    path.write_text(body)
    with pytest.raises(BatchError, match=error):
        read_batch(path)
