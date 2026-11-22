"""Operator CLI: walk through a batch CSV, encode one tag per row, write a results CSV.

    ntag424-encode batch.csv --base-url https://example.com
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Protocol

from .batch import BatchError, OutputRow, append_output, read_batch, read_output
from .commands import ApduError, Ntag424
from .keysource import KeySourceError, MasterKey, load_from_env, load_from_openbao
from .personalize import EncodeError, personalize_tag
from .transport import Transport

WARNING = """\
WARNING: encoding is IRREVERSIBLE without the master key.
Each tag's keys are replaced with keys derived from the master key ({key_ref}).
If that master key is ever lost, these tags can never be reconfigured and taps can never be verified.
Make sure the OpenBao master key is backed up before continuing."""


class Reader(Protocol):
    def wait_for_tag(self) -> Transport: ...

    def wait_for_removal(self) -> None: ...


def _parse_args(argv: list[str] | None, environ: dict[str, str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="ntag424-encode", description="Encode NTAG 424 DNA tags from a batch CSV.")
    p.add_argument("batch_csv", type=Path, help="batch CSV from the admin batch generator")
    p.add_argument("-o", "--output", type=Path, help="results CSV (default: <batch>.encoded.csv); resumable")
    p.add_argument(
        "--base-url",
        default=environ.get("APP_BASE_URL"),
        help="expected APP_BASE_URL; every nfc_url must be {base-url}/t/{tag_id} (default: $APP_BASE_URL)",
    )
    p.add_argument("--key-source", choices=["openbao", "env"], default="openbao")
    p.add_argument("--key-version", type=int, help="OpenBao KV version of the master key (default: latest)")
    p.add_argument("--reader", default="ACR1252", help="substring of the PC/SC reader name")
    p.add_argument("--yes", action="store_true", help="skip the irreversibility confirmation")
    return p.parse_args(argv)


def _load_key(args: argparse.Namespace, environ: dict[str, str]) -> MasterKey:
    if args.key_source == "env":
        return load_from_env(environ)
    return load_from_openbao(
        environ.get("OPENBAO_ADDR", ""),
        environ.get("OPENBAO_TOKEN", ""),
        mount=environ.get("NTAG424_KV_MOUNT", "secret"),
        path=environ.get("NTAG424_KV_PATH", "ntag424/master-key"),
        version=args.key_version,
    )


def main(
    argv: list[str] | None = None,
    *,
    reader: Reader | None = None,
    prompt: Callable[[str], str] = input,
    out: Callable[[str], None] = print,
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    environ: dict[str, str] | None = None,
    key_loader: Callable[[argparse.Namespace, dict[str, str]], MasterKey] = _load_key,
) -> int:
    env = dict(os.environ if environ is None else environ)
    args = _parse_args(argv, env)
    output = args.output or args.batch_csv.with_suffix(".encoded.csv")

    try:
        rows = read_batch(args.batch_csv, args.base_url)
        previous = read_output(output)
        master = key_loader(args, env)
    except (BatchError, KeySourceError, OSError) as exc:
        out(f"error: {exc}")
        return 2

    done = {r.tag_id for r in previous if r.status == "ok"}
    encoded_uids = {r.uid for r in previous if r.status == "ok"}
    pending = [r for r in rows if r.tag_id not in done]
    out(f"{len(rows)} tags in batch, {len(done)} already encoded, {len(pending)} to go. Results: {output}")
    if not pending:
        return 0

    out(WARNING.format(key_ref=master.key_ref))
    if not args.yes and prompt("Type ENCODE to continue: ").strip() != "ENCODE":
        out("Aborted.")
        return 1

    if reader is None:
        from .transport import PcscReader

        try:
            reader = PcscReader(args.reader)
        except RuntimeError as exc:
            out(f"error: {exc}")
            return 2

    failures = 0
    for index, row in enumerate(pending, start=1):
        while True:
            answer = prompt(f"[{index}/{len(pending)}] Place a blank tag for {row.tag_id}, press Enter (s=skip, q=quit): ")
            choice = answer.strip().lower()
            if choice == "q":
                out("Stopped. Re-run the same command to resume.")
                return 1
            if choice == "s":
                failures += 1
                break

            tag = Ntag424(reader.wait_for_tag())
            uid = ""
            try:
                uid = tag.get_uid().hex().upper()
                if uid in encoded_uids:
                    out(f"  This tag ({uid}) was already encoded in this batch. Use a fresh tag.")
                    reader.wait_for_removal()
                    continue
                result = personalize_tag(tag, master.key, row.nfc_url, master.version)
                status, message = "ok", f"  OK: {row.tag_id} -> UID {result.uid}"
            except EncodeError as exc:
                status, message = exc.status, f"  FAILED ({exc.status}): {exc}"
            except ApduError as exc:
                status, message = "error", f"  FAILED (error): {exc}"
            except Exception as exc:  # reader I/O etc.; never include APDU bodies or keys
                status, message = "error", f"  FAILED (error): {type(exc).__name__}"

            append_output(output, OutputRow(row.tag_id, uid, now().isoformat(timespec="seconds"), status, master.key_ref))
            out(message)
            out("  Remove the tag.")
            reader.wait_for_removal()
            if status == "ok":
                encoded_uids.add(uid)
                break
            out("  Set that tag aside and try another blank tag for the same tag_id.")

    if failures:
        out(f"Done with {failures} skipped tag(s). Re-run to encode them.")
        return 1
    out("All tags encoded.")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
