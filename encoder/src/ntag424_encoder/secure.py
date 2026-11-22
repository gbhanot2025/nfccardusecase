"""EV2 secure messaging for NTAG 424 DNA (datasheet section 9.1, AN12196 section 5)."""

from __future__ import annotations

import hmac
from dataclasses import dataclass

from .crypto import aes_cbc_encrypt, aes_cmac, aes_ecb_encrypt, pad_iso9797_m2, truncate_mac


def rotate_left(data: bytes) -> bytes:
    return data[1:] + data[:1]


def session_vectors(rnd_a: bytes, rnd_b: bytes) -> tuple[bytes, bytes]:
    """SV1/SV2 for AuthenticateEV2First (AN12196 Table 14 steps 25-26)."""
    xored = bytes(a ^ b for a, b in zip(rnd_a[2:8], rnd_b[0:6]))
    tail = rnd_a[0:2] + xored + rnd_b[6:16] + rnd_a[8:16]
    return bytes.fromhex("A55A00010080") + tail, bytes.fromhex("5AA500010080") + tail


class ResponseMacError(Exception):
    """The tag's response MAC didn't verify: the session can't be trusted."""


@dataclass
class SecureSession:
    """State after AuthenticateEV2First. Keys stay in memory only; repr never shows them."""

    key_no: int
    ti: bytes
    ses_enc: bytes
    ses_mac: bytes
    cmd_ctr: int = 0

    def __repr__(self) -> str:
        return f"SecureSession(key_no={self.key_no}, ti={self.ti.hex()}, cmd_ctr={self.cmd_ctr})"

    def _ctr(self, value: int | None = None) -> bytes:
        return (self.cmd_ctr if value is None else value).to_bytes(2, "little")

    def command_iv(self) -> bytes:
        return aes_ecb_encrypt(self.ses_enc, b"\xa5\x5a" + self.ti + self._ctr() + bytes(8))

    def command_mac(self, cmd: int, header: bytes, data: bytes) -> bytes:
        return truncate_mac(aes_cmac(self.ses_mac, bytes([cmd]) + self._ctr() + self.ti + header + data))

    def wrap_full(self, cmd: int, header: bytes, data: bytes) -> bytes:
        """CommMode.Full: encrypt data (ISO 9797-1 M2 padding), then MAC header + ciphertext."""
        enc = aes_cbc_encrypt(self.ses_enc, self.command_iv(), pad_iso9797_m2(data))
        body = header + enc + self.command_mac(cmd, header, enc)
        return bytes([0x90, cmd, 0x00, 0x00, len(body)]) + body + b"\x00"

    def check_response(self, data: bytes, sw: int) -> bytes:
        """Verify the response MACt (CommMode.MAC/Full) and advance the counter. Returns data without MAC."""
        self.cmd_ctr += 1
        if len(data) < 8:
            raise ResponseMacError("response too short for a MAC")
        payload, mac = data[:-8], data[-8:]
        expected = truncate_mac(aes_cmac(self.ses_mac, bytes([sw & 0xFF]) + self._ctr() + self.ti + payload))
        if not hmac.compare_digest(expected, mac):
            raise ResponseMacError("response MAC mismatch")
        return payload
