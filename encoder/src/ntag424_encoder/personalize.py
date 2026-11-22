"""Personalize one factory-fresh NTAG 424 DNA: NDEF URL, SDM/SUN settings, diversified keys, verification."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit

from .commands import (
    NDEF_FILE_NO,
    SW_SECURITY_STATUS,
    ApduError,
    AuthenticationError,
    Ntag424,
)
from .crypto import (
    FACTORY_KEY,
    SLOT_APP_MASTER,
    SLOT_SDM_FILE_READ,
    SLOT_SDM_META_READ,
    derive_all_keys,
    verify_sun,
)
from .ndef import build_sun_ndef, parse_uri_record, sdm_file_settings
from .secure import ResponseMacError

# Change every non-auth key first; key 0 last, because changing the authenticated key ends the session.
_KEY_ORDER = (1, 2, 3, 4, SLOT_APP_MASTER)


class EncodeError(Exception):
    """A per-tag failure. `status` goes in the output CSV; the message never contains key material."""

    def __init__(self, status: str, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class EncodedTag:
    uid: str  # uppercase hex
    counter: int  # SDMReadCtr seen in the verification read


def key_version_byte(master_key_version: int) -> int:
    """KeyVer stored on the tag: the OpenBao version folded into 1..255 (diagnostics only)."""
    return (max(master_key_version, 1) - 1) % 255 + 1


def personalize_tag(tag: Ntag424, master_key: bytes, nfc_url: str, master_key_version: int = 1) -> EncodedTag:
    uid = tag.get_uid()
    keys = derive_all_keys(master_key, uid)
    layout = build_sun_ndef(nfc_url)
    version = key_version_byte(master_key_version)

    # 1. Write the NDEF URL while the file is still freely writable (factory state).
    tag.select_ndef_app()
    tag.select_ndef_file()
    try:
        tag.update_binary(0, layout.file_data)
    except ApduError as exc:
        if exc.sw == SW_SECURITY_STATUS:
            raise EncodeError("not_blank", "NDEF file is write-protected: this tag was already encoded") from None
        raise

    # 2. Authenticate with the factory key 0.
    try:
        session = tag.authenticate_ev2_first(SLOT_APP_MASTER, FACTORY_KEY)
    except AuthenticationError:
        raise EncodeError("not_blank", "factory key 0 rejected: this tag was already encoded") from None

    # 3. Enable SUN mirroring and lock writes to key 0. 4. Replace all five keys.
    try:
        tag.change_file_settings(session, NDEF_FILE_NO, sdm_file_settings(layout))
        for slot in _KEY_ORDER:
            tag.change_key(session, slot, FACTORY_KEY, keys[slot], version)
    except ResponseMacError:
        raise EncodeError("error", "tag response failed MAC verification; set the tag aside") from None
    except ApduError as exc:
        raise EncodeError("partial", f"{exc}; tag may be partially encoded, set it aside") from None

    # 5. Verify like the server would: read the URL back and check the SUN MAC with the new keys.
    try:
        tag.select_ndef_app()
        tag.select_ndef_file()
        url = parse_uri_record(tag.read_binary(0, len(layout.file_data)))
    except (ApduError, ValueError) as exc:
        raise EncodeError("verify_failed", f"could not read back the NDEF URL: {exc}") from None

    parts = urlsplit(url)
    base = f"{parts.scheme}://{parts.netloc}{parts.path}"
    query = parse_qs(parts.query, strict_parsing=True) if parts.query else {}
    if base != nfc_url or set(query) != {"picc", "cmac"} or any(len(v) != 1 for v in query.values()):
        raise EncodeError("verify_failed", "read-back URL does not match the template")
    picc = verify_sun(
        query["picc"][0],
        query["cmac"][0],
        keys[SLOT_SDM_META_READ],
        lambda tag_uid: keys[SLOT_SDM_FILE_READ] if tag_uid == uid else bytes(16),
    )
    if picc is None or picc.uid != uid or picc.counter < 1:
        raise EncodeError("verify_failed", "SUN message did not verify with the new keys")

    # 6. Prove the new key 0 works (otherwise the tag could never be reconfigured).
    try:
        tag.authenticate_ev2_first(SLOT_APP_MASTER, keys[SLOT_APP_MASTER])
    except (AuthenticationError, ApduError):
        raise EncodeError("verify_failed", "new key 0 was not accepted") from None

    return EncodedTag(uid=uid.hex().upper(), counter=picc.counter)
