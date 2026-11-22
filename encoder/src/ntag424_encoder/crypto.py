"""AES-128 primitives, AN10922 key diversification and SUN verification.

Must stay byte-for-byte identical to the server (src/server/ntag424/): both are pinned by
tests/fixtures/ntag424-vectors.json at the repository root.
"""

from __future__ import annotations

import hmac
import zlib
from dataclasses import dataclass
from typing import Callable

from Crypto.Cipher import AES
from Crypto.Hash import CMAC

BLOCK = 16
UID_LEN = 7
ZERO_IV = bytes(BLOCK)
FACTORY_KEY = bytes(BLOCK)

# AN10922 "system identifier" for this platform. Never change it for existing tags: every key depends on it.
SYSTEM_IDENTIFIER = b"TagPlatformNTAG424v1"

# Application key slots (see src/server/ntag424/diversify.ts KEY_SLOT).
SLOT_APP_MASTER = 0
SLOT_SDM_FILE_READ = 1  # per-tag; signs the SUN CMAC
SLOT_SDM_META_READ = 2  # system-wide; encrypts PICC data (server must decrypt before it knows the UID)
SLOT_UNUSED_3 = 3
SLOT_UNUSED_4 = 4

_PER_TAG_PREFIX = b"T"
_SYSTEM_WIDE_PREFIX = b"S"


def _check_key(key: bytes, name: str = "key") -> None:
    if not isinstance(key, (bytes, bytearray)) or len(key) != BLOCK:
        raise ValueError(f"{name} must be a 16-byte AES-128 key")


def aes_cmac(key: bytes, message: bytes) -> bytes:
    """AES-128 CMAC (NIST SP 800-38B), full 16 bytes."""
    _check_key(key)
    mac = CMAC.new(bytes(key), ciphermod=AES)
    mac.update(bytes(message))
    return mac.digest()


def truncate_mac(full_mac: bytes) -> bytes:
    """NXP truncation: bytes at odd indices (S14 || S12 || ... || S0 in NXP numbering)."""
    if len(full_mac) != BLOCK:
        raise ValueError("MAC must be 16 bytes")
    return bytes(full_mac[1::2])


def aes_ecb_encrypt(key: bytes, data: bytes) -> bytes:
    _check_key(key)
    return AES.new(bytes(key), AES.MODE_ECB).encrypt(bytes(data))


def aes_cbc_encrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    _check_key(key)
    return AES.new(bytes(key), AES.MODE_CBC, iv=bytes(iv)).encrypt(bytes(data))


def aes_cbc_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    _check_key(key)
    return AES.new(bytes(key), AES.MODE_CBC, iv=bytes(iv)).decrypt(bytes(data))


def pad_iso9797_m2(data: bytes) -> bytes:
    """ISO/IEC 9797-1 padding method 2 (always adds 0x80, then zeros to a block boundary)."""
    padded = bytes(data) + b"\x80"
    return padded + bytes(-len(padded) % BLOCK)


def crc32_nxp(data: bytes) -> bytes:
    """CRC32 as used by ChangeKey: JAMCRC (no final XOR), little-endian."""
    return ((zlib.crc32(bytes(data)) ^ 0xFFFFFFFF) & 0xFFFFFFFF).to_bytes(4, "little")


def an10922_diversify_aes128(master_key: bytes, diversification_input: bytes) -> bytes:
    """NXP AN10922 section 2.2: CMAC(K, 0x01 || M), 1 <= len(M) <= 31."""
    _check_key(master_key, "master_key")
    if not 1 <= len(diversification_input) <= 31:
        raise ValueError("AN10922 diversification input must be 1..31 bytes")
    return aes_cmac(master_key, b"\x01" + bytes(diversification_input))


def _check_slot(slot: int) -> None:
    if slot not in range(5):
        raise ValueError("key slot must be 0..4")


def derive_per_tag_key(master_key: bytes, uid: bytes, slot: int) -> bytes:
    """M = "T" || UID(7) || slot(1) || SYSTEM_IDENTIFIER."""
    if len(uid) != UID_LEN:
        raise ValueError("NTAG 424 DNA UID must be 7 bytes")
    _check_slot(slot)
    return an10922_diversify_aes128(master_key, _PER_TAG_PREFIX + bytes(uid) + bytes([slot]) + SYSTEM_IDENTIFIER)


def derive_system_key(master_key: bytes, slot: int) -> bytes:
    """M = "S" || slot(1) || SYSTEM_IDENTIFIER. Same for every tag."""
    _check_slot(slot)
    return an10922_diversify_aes128(master_key, _SYSTEM_WIDE_PREFIX + bytes([slot]) + SYSTEM_IDENTIFIER)


def derive_all_keys(master_key: bytes, uid: bytes) -> dict[int, bytes]:
    """The five application keys the encoder writes to a tag."""
    keys = {slot: derive_per_tag_key(master_key, uid, slot) for slot in range(5)}
    keys[SLOT_SDM_META_READ] = derive_system_key(master_key, SLOT_SDM_META_READ)
    return keys


# --- SUN / SDM (AN12196 section 3.4) ---------------------------------------------------------

PICC_DATA_TAG = 0xC7  # UID mirror + SDMReadCtr mirror + 7-byte UID


@dataclass(frozen=True)
class PiccData:
    uid: bytes
    counter_bytes: bytes

    @property
    def counter(self) -> int:
        return int.from_bytes(self.counter_bytes, "little")


def decrypt_picc_data(meta_read_key: bytes, encrypted: bytes) -> PiccData | None:
    if len(encrypted) != BLOCK:
        raise ValueError("PICC data must be 16 bytes")
    plain = aes_cbc_decrypt(meta_read_key, ZERO_IV, encrypted)
    if plain[0] != PICC_DATA_TAG:
        return None
    return PiccData(uid=plain[1:8], counter_bytes=plain[8:11])


def sdm_session_vector2(uid: bytes, counter_bytes: bytes) -> bytes:
    return bytes.fromhex("3CC300010080") + bytes(uid) + bytes(counter_bytes)


def sdm_session_mac_key(file_read_key: bytes, uid: bytes, counter_bytes: bytes) -> bytes:
    return aes_cmac(file_read_key, sdm_session_vector2(uid, counter_bytes))


def sdm_mac(session_mac_key: bytes, mac_input: bytes = b"") -> bytes:
    return truncate_mac(aes_cmac(session_mac_key, mac_input))


def _is_hex(value: str, length: int) -> bool:
    return len(value) == length and all(c in "0123456789abcdefABCDEF" for c in value)


def verify_sun(
    picc_hex: str, cmac_hex: str, meta_read_key: bytes, file_read_key_for_uid: Callable[[bytes], bytes]
) -> PiccData | None:
    """Same checks as the server's verifyTap(). Returns None on any failure."""
    if not (isinstance(picc_hex, str) and isinstance(cmac_hex, str)):
        return None
    if not (_is_hex(picc_hex, 32) and _is_hex(cmac_hex, 16)):
        return None
    picc = decrypt_picc_data(meta_read_key, bytes.fromhex(picc_hex))
    if picc is None:
        return None
    expected = sdm_mac(sdm_session_mac_key(file_read_key_for_uid(picc.uid), picc.uid, picc.counter_bytes))
    if not hmac.compare_digest(expected, bytes.fromhex(cmac_hex)):
        return None
    return picc
