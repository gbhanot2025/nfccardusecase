"""NDEF URI record with SUN placeholders, and the matching SDM file settings.

The tag rewrites the placeholders on every read:
    {nfc_url}?picc={32 hex: encrypted PICC data}&cmac={16 hex: truncated SDM MAC}
Offsets are counted from the start of the NDEF file (including the 2-byte NLEN).
The MAC input is empty (SDMMACInputOffset == SDMMACOffset), as in AN12196 Table 4.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .commands import NDEF_FILE_SIZE
from .crypto import SLOT_SDM_FILE_READ, SLOT_SDM_META_READ

PICC_PLACEHOLDER = "0" * 32
CMAC_PLACEHOLDER = "0" * 16

# NFC Forum URI RTD prefix codes we use; anything else is stored in full (code 0x00).
_URI_PREFIXES = [("https://", 0x04), ("http://", 0x03)]

# Bytes before the URI text: NLEN(2) + record header D1, type length, payload length, type "U" (4) + prefix code (1).
_URI_TEXT_OFFSET = 7

_TAG_URL = re.compile(r"^https?://[A-Za-z0-9.:\[\]-]+(/[A-Za-z0-9._~%-]+)*/t/[A-Za-z0-9_-]{4,64}$")


@dataclass(frozen=True)
class SunLayout:
    url_template: str
    file_data: bytes
    picc_offset: int
    mac_input_offset: int
    mac_offset: int


def validate_tag_url(nfc_url: str) -> None:
    """The encoder only writes `{APP_BASE_URL}/t/{tagId}` style URLs without query or fragment."""
    if not _TAG_URL.match(nfc_url):
        raise ValueError("nfc_url must look like https://host/t/{tagId} with no query string or fragment")


def build_sun_ndef(nfc_url: str, picc_param: str = "picc", cmac_param: str = "cmac") -> SunLayout:
    if "?" in nfc_url or "#" in nfc_url or not nfc_url.isascii():
        raise ValueError("nfc_url must be ASCII with no query string or fragment")
    url = f"{nfc_url}?{picc_param}={PICC_PLACEHOLDER}&{cmac_param}={CMAC_PLACEHOLDER}"

    code, rest = 0x00, url
    for prefix, prefix_code in _URI_PREFIXES:
        if url.startswith(prefix):
            code, rest = prefix_code, url[len(prefix) :]
            break

    payload = bytes([code]) + rest.encode("ascii")
    if len(payload) > 255:
        raise ValueError("URL too long for a short NDEF record")
    record = bytes([0xD1, 0x01, len(payload), 0x55]) + payload
    file_data = len(record).to_bytes(2, "big") + record
    if len(file_data) > NDEF_FILE_SIZE:
        raise ValueError("NDEF message does not fit the 256-byte NDEF file")

    picc_offset = _URI_TEXT_OFFSET + rest.index(f"?{picc_param}=") + len(picc_param) + 2
    mac_offset = _URI_TEXT_OFFSET + rest.index(f"&{cmac_param}=") + len(cmac_param) + 2
    return SunLayout(url, file_data, picc_offset, mac_offset, mac_offset)


def _offset3(value: int) -> bytes:
    return value.to_bytes(3, "little")


# Access-rights nibbles: 0x0-0x4 = key slot, 0xE = free, 0xF = never.
FREE = 0xE
NEVER = 0xF


def sdm_file_settings(layout: SunLayout) -> bytes:
    """ChangeFileSettings data for the NDEF file (NTAG 424 DNA datasheet 10.7.1; AN12196 Table 18).

    FileOption 0x40      SDM enabled, CommMode.Plain (phones read it without authentication)
    AccessRights 00 E0   RW=key0, Change=key0 | Read=free, Write=key0
    SDMOptions 0xC1      UID mirror + SDMReadCtr mirror + ASCII encoding
    SDMAccessRights      CtrRet=key1, MetaRead=key2 (PICC data encrypted), FileRead=key1 (MAC)
    then PICCDataOffset, SDMMACInputOffset, SDMMACOffset (3 bytes each, LSB first)
    """
    file_option = 0x40
    access_rights = bytes([(0x0 << 4) | 0x0, (FREE << 4) | 0x0])
    sdm_options = 0xC1
    sdm_access_rights = bytes([(NEVER << 4) | SLOT_SDM_FILE_READ, (SLOT_SDM_META_READ << 4) | SLOT_SDM_FILE_READ])
    return (
        bytes([file_option])
        + access_rights
        + bytes([sdm_options])
        + sdm_access_rights
        + _offset3(layout.picc_offset)
        + _offset3(layout.mac_input_offset)
        + _offset3(layout.mac_offset)
    )


def parse_uri_record(file_data: bytes) -> str:
    """Decode the single URI record we wrote (as read back from the tag, including NLEN)."""
    if len(file_data) < 7 or file_data[2:4] != b"\xd1\x01" or file_data[5] != 0x55:
        raise ValueError("not a single short URI record")
    payload_len = file_data[4]
    payload = file_data[6 : 6 + payload_len]
    if len(payload) != payload_len:
        raise ValueError("truncated URI record")
    prefix = {code: text for text, code in _URI_PREFIXES}.get(payload[0], "")
    return prefix + payload[1:].decode("ascii")
