"""Batch CSV input and the encoding-result CSV output.

Input columns (from the admin batch generator): batch_id, tag_id, public_code, nfc_url, qr_url, claim_code.
Only tag_id and nfc_url are read. claim_code is never stored, printed or copied anywhere.
"""

from __future__ import annotations

import csv
import os
import re
from dataclasses import dataclass
from pathlib import Path

from .ndef import validate_tag_url

OUTPUT_COLUMNS = ["tag_id", "uid", "encoded_at", "status", "key_ref"]
_TAG_ID = re.compile(r"^[A-Za-z0-9_-]{4,64}$")


class BatchError(Exception):
    pass


@dataclass(frozen=True)
class BatchRow:
    tag_id: str
    nfc_url: str


@dataclass(frozen=True)
class OutputRow:
    tag_id: str
    uid: str
    encoded_at: str
    status: str
    key_ref: str

    def as_dict(self) -> dict[str, str]:
        return {c: getattr(self, c) for c in OUTPUT_COLUMNS}


def read_batch(path: Path, base_url: str | None = None) -> list[BatchRow]:
    rows: list[BatchRow] = []
    seen: set[str] = set()
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = {"tag_id", "nfc_url"} - set(reader.fieldnames or [])
        if missing:
            raise BatchError(f"batch CSV is missing columns: {', '.join(sorted(missing))}")
        for line, record in enumerate(reader, start=2):
            tag_id = (record.get("tag_id") or "").strip()
            nfc_url = (record.get("nfc_url") or "").strip()
            if not _TAG_ID.match(tag_id):
                raise BatchError(f"line {line}: invalid tag_id")
            try:
                validate_tag_url(nfc_url)
            except ValueError as exc:
                raise BatchError(f"line {line}: {exc}") from None
            if not nfc_url.endswith(f"/t/{tag_id}"):
                raise BatchError(f"line {line}: nfc_url does not end with /t/{tag_id}")
            if base_url is not None and nfc_url != f"{base_url.rstrip('/')}/t/{tag_id}":
                raise BatchError(f"line {line}: nfc_url is not on the expected base URL")
            if tag_id in seen:
                raise BatchError(f"line {line}: duplicate tag_id {tag_id}")
            seen.add(tag_id)
            rows.append(BatchRow(tag_id=tag_id, nfc_url=nfc_url))
    return rows


def read_output(path: Path) -> list[OutputRow]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != OUTPUT_COLUMNS:
            raise BatchError("output CSV has unexpected columns; refusing to append to it")
        return [OutputRow(**{c: r[c] for c in OUTPUT_COLUMNS}) for r in reader]


def append_output(path: Path, row: OutputRow) -> None:
    """Append one row and fsync, so a crash never loses which tags were encoded."""
    new = not path.exists() or path.stat().st_size == 0
    with path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
        if new:
            writer.writeheader()
        writer.writerow(row.as_dict())
        f.flush()
        os.fsync(f.fileno())
