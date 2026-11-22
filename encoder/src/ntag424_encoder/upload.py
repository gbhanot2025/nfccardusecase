"""Uploading encoding results to the server — NOT IMPLEMENTED (out of scope for this milestone).

TODO(milestone 2+): the server needs, per tag: tag_id, uid, key_ref. The plan is an admin-only,
authenticated endpoint (or an admin CSV import) that stores the UID with the tag so /t/{tagId} can
check that a verified SUN message's UID belongs to that tag. Until then, the output CSV written by
the CLI (tag_id, uid, encoded_at, status, key_ref) is the hand-off format.
"""

from __future__ import annotations

from typing import Iterable, Protocol

from .batch import OutputRow


class ResultUploader(Protocol):
    def upload(self, rows: Iterable[OutputRow]) -> None:
        """Send successfully encoded tags (status == "ok") to the server. Must never send keys."""
        ...


class NotImplementedUploader:
    def upload(self, rows: Iterable[OutputRow]) -> None:
        raise NotImplementedError("Upload the output CSV to the admin import instead (not built yet)")
