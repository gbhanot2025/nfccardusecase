"""A minimal NTAG 424 DNA simulator implementing the tag side of the commands the encoder uses.

It follows the NTAG 424 DNA datasheet / AN12196 behaviour closely enough to run the whole
personalization end to end, including SDM mirroring on read. Primitives come from pycryptodome
directly (not the encoder's secure.py), so host and tag secure messaging are independent code.
"""

from __future__ import annotations

import hmac
import zlib

from Crypto.Cipher import AES
from Crypto.Hash import CMAC


def _cmac(key: bytes, data: bytes) -> bytes:
    c = CMAC.new(key, ciphermod=AES)
    c.update(data)
    return c.digest()


def _mact(key: bytes, data: bytes) -> bytes:
    return _cmac(key, data)[1::2]


def _cbc_enc(key: bytes, iv: bytes, data: bytes) -> bytes:
    return AES.new(key, AES.MODE_CBC, iv=iv).encrypt(data)


def _cbc_dec(key: bytes, iv: bytes, data: bytes) -> bytes:
    return AES.new(key, AES.MODE_CBC, iv=iv).decrypt(data)


def _unpad(data: bytes) -> bytes:
    i = data.rstrip(b"\x00")
    assert i.endswith(b"\x80"), "bad ISO 9797-1 M2 padding"
    return i[:-1]


class SimulatedNtag424:
    APP = bytes.fromhex("D2760000850101")

    def __init__(self, uid: bytes, rng) -> None:
        self.uid = uid
        self.rng = rng
        self.keys = [bytes(16)] * 5
        self.key_versions = [0] * 5
        self.ndef = bytearray(256)
        # Factory NDEF file: CommMode plain, Read/Write/RW free, Change key 0.
        self.access = {"read": 0xE, "write": 0xE, "rw": 0xE, "change": 0x0}
        self.sdm: dict | None = None
        self.read_ctr = 0
        self.app_selected = False
        self.file_selected = False
        self.session: dict | None = None
        self._pending_auth: dict | None = None
        self.log: list[bytes] = []
        self.fail_on: set[int] = set()  # INS bytes to fail with 91 1E (for error-path tests)

    # ---------------------------------------------------------------------------------------
    def transmit(self, apdu: bytes) -> tuple[bytes, int]:
        self.log.append(apdu)
        cla, ins = apdu[0], apdu[1]
        if cla == 0xFF and ins == 0xCA:
            return self.uid, 0x9000
        if cla == 0x00:
            return self._iso(apdu)
        if cla == 0x90:
            if ins in self.fail_on:
                return b"", 0x911E
            body = apdu[5 : 5 + apdu[4]] if len(apdu) > 5 else b""
            return self._native(ins, body)
        return b"", 0x6E00

    # --- ISO --------------------------------------------------------------------------------
    def _iso(self, apdu: bytes) -> tuple[bytes, int]:
        ins, p1, p2 = apdu[1], apdu[2], apdu[3]
        if ins == 0xA4:
            data = apdu[5 : 5 + apdu[4]]
            self.session = None  # ISO select resets authentication
            if p1 == 0x04 and data == self.APP:
                self.app_selected, self.file_selected = True, False
                return b"", 0x9000
            if p1 == 0x00 and data == bytes.fromhex("E104") and self.app_selected:
                self.file_selected = True
                return b"", 0x9000
            return b"", 0x6A82
        if not self.file_selected:
            return b"", 0x6985
        offset = (p1 << 8) | p2
        if ins == 0xD6:
            if self.access["write"] != 0xE and self.access["rw"] != 0xE:
                return b"", 0x6982
            data = apdu[5 : 5 + apdu[4]]
            if offset + len(data) > len(self.ndef):
                return b"", 0x6700
            self.ndef[offset : offset + len(data)] = data
            return b"", 0x9000
        if ins == 0xB0:
            length = apdu[4] or 256
            if self.access["read"] != 0xE:
                return b"", 0x6982
            content = self._sdm_view() if self.sdm else bytes(self.ndef)
            return content[offset : offset + length], 0x9000
        return b"", 0x6D00

    def _sdm_view(self) -> bytes:
        """Mirror encrypted PICC data and the SDM MAC (counter increments on every read)."""
        self.read_ctr += 1
        sdm = self.sdm
        assert sdm is not None
        view = bytearray(self.ndef)
        ctr = self.read_ctr.to_bytes(3, "little")
        picc_plain = bytes([0xC7]) + self.uid + ctr + self.rng(5)
        picc = _cbc_enc(self.keys[sdm["meta"]], bytes(16), picc_plain)
        view[sdm["picc"] : sdm["picc"] + 32] = picc.hex().upper().encode()
        ses = _cmac(self.keys[sdm["file"]], bytes.fromhex("3CC300010080") + self.uid + ctr)
        mac = _mact(ses, bytes(view[sdm["mac_in"] : sdm["mac"]]))
        view[sdm["mac"] : sdm["mac"] + 16] = mac.hex().upper().encode()
        return bytes(view)

    # --- Native -------------------------------------------------------------------------------
    def _native(self, ins: int, body: bytes) -> tuple[bytes, int]:
        if ins == 0x71:
            key_no = body[0]
            if key_no > 4:
                return b"", 0x917E
            rnd_b = self.rng(16)
            self._pending_auth = {"key_no": key_no, "rnd_b": rnd_b}
            self.session = None
            return _cbc_enc(self.keys[key_no], bytes(16), rnd_b), 0x91AF
        if ins == 0xAF:
            pending, self._pending_auth = self._pending_auth, None
            if pending is None or len(body) != 32:
                return b"", 0x91CA
            key = self.keys[pending["key_no"]]
            plain = _cbc_dec(key, bytes(16), body)
            rnd_a, rnd_b_rot = plain[:16], plain[16:]
            rnd_b = pending["rnd_b"]
            if rnd_b_rot != rnd_b[1:] + rnd_b[:1]:
                return b"", 0x91AE
            ti = self.rng(4)
            x = bytes(a ^ b for a, b in zip(rnd_a[2:8], rnd_b[0:6]))
            tail = rnd_a[0:2] + x + rnd_b[6:16] + rnd_a[8:16]
            self.session = {
                "key_no": pending["key_no"],
                "ti": ti,
                "ctr": 0,
                "enc": _cmac(key, bytes.fromhex("A55A00010080") + tail),
                "mac": _cmac(key, bytes.fromhex("5AA500010080") + tail),
            }
            resp = ti + rnd_a[1:] + rnd_a[:1] + bytes(12)
            return _cbc_enc(key, bytes(16), resp), 0x9100
        if ins in (0x5F, 0xC4):
            return self._full_mode(ins, body)
        return b"", 0x911C

    def _full_mode(self, ins: int, body: bytes) -> tuple[bytes, int]:
        s = self.session
        if s is None:
            return b"", 0x91AE
        header, enc, mac = body[:1], body[1:-8], body[-8:]
        ctr = s["ctr"].to_bytes(2, "little")
        if not hmac.compare_digest(_mact(s["mac"], bytes([ins]) + ctr + s["ti"] + header + enc), mac):
            self.session = None
            return b"", 0x911E
        iv = AES.new(s["enc"], AES.MODE_ECB).encrypt(b"\xa5\x5a" + s["ti"] + ctr + bytes(8))
        data = _unpad(_cbc_dec(s["enc"], iv, enc))

        if ins == 0x5F:
            if header[0] != 0x02 or s["key_no"] != self.access["change"]:
                return b"", 0x919D
            self._apply_file_settings(data)
        else:
            key_no = header[0]
            if s["key_no"] != 0:
                return b"", 0x919D
            if key_no == s["key_no"]:
                self.keys[key_no], self.key_versions[key_no] = data[:16], data[16]
                self.session = None
                return b"", 0x9100
            new = bytes(a ^ b for a, b in zip(data[:16], self.keys[key_no]))
            crc = ((zlib.crc32(new) ^ 0xFFFFFFFF) & 0xFFFFFFFF).to_bytes(4, "little")
            if data[17:21] != crc:
                return b"", 0x911E
            self.keys[key_no], self.key_versions[key_no] = new, data[16]

        s["ctr"] += 1
        resp_mac = _mact(s["mac"], b"\x00" + s["ctr"].to_bytes(2, "little") + s["ti"])
        return resp_mac, 0x9100

    def _apply_file_settings(self, data: bytes) -> None:
        file_option, ar0, ar1 = data[0], data[1], data[2]
        self.access = {"rw": ar0 >> 4, "change": ar0 & 0xF, "read": ar1 >> 4, "write": ar1 & 0xF}
        if not file_option & 0x40:
            self.sdm = None
            return
        assert data[3] == 0xC1, "simulator only supports UID+ctr mirror, ASCII"
        ctr_ret, meta, file_read = data[4] & 0xF, data[5] >> 4, data[5] & 0xF
        off = lambda i: int.from_bytes(data[i : i + 3], "little")  # noqa: E731
        assert meta <= 4 and file_read <= 4, "simulator only supports encrypted PICC data with a MAC"
        self.sdm = {"ctr_ret": ctr_ret, "meta": meta, "file": file_read, "picc": off(6), "mac_in": off(9), "mac": off(12)}


class DeterministicRng:
    """Reproducible 'random' bytes for tests (so shared vectors are stable)."""

    def __init__(self, seed: bytes) -> None:
        self._state = seed
        self._counter = 0

    def __call__(self, n: int) -> bytes:
        out = b""
        while len(out) < n:
            self._counter += 1
            out += _cmac(bytes(16), self._state + self._counter.to_bytes(4, "big"))
        return out[:n]
