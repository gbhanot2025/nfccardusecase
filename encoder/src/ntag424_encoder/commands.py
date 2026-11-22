"""NTAG 424 DNA commands used for personalization. Error messages never contain APDU bodies or keys."""

from __future__ import annotations

import hmac
import os
from typing import Callable

from .crypto import ZERO_IV, aes_cbc_decrypt, aes_cbc_encrypt, aes_cmac, crc32_nxp
from .secure import SecureSession, rotate_left, session_vectors
from .transport import Transport

NDEF_APP_DF_NAME = bytes.fromhex("D2760000850101")
NDEF_FILE_ID = bytes.fromhex("E104")
NDEF_FILE_NO = 0x02
NDEF_FILE_SIZE = 256

SW_OK = 0x9000
SW_DESFIRE_OK = 0x9100
SW_ADDITIONAL_FRAME = 0x91AF
SW_AUTHENTICATION_ERROR = 0x91AE
SW_SECURITY_STATUS = 0x6982

WRITE_CHUNK = 48  # conservative frame size for ISO UPDATE BINARY


class ApduError(Exception):
    def __init__(self, command: str, sw: int) -> None:
        super().__init__(f"{command} failed with SW {sw:04X}")
        self.command = command
        self.sw = sw


class AuthenticationError(Exception):
    pass


class Ntag424:
    def __init__(self, transport: Transport, random_bytes: Callable[[int], bytes] = os.urandom) -> None:
        self._t = transport
        self._random = random_bytes

    def _tx(self, name: str, apdu: bytes, ok: tuple[int, ...] = (SW_OK,)) -> bytes:
        data, sw = self._t.transmit(apdu)
        if sw not in ok:
            raise ApduError(name, sw)
        return data

    # --- ISO 7816-4 / PC/SC ---------------------------------------------------------------

    def get_uid(self) -> bytes:
        """PC/SC GET DATA (FF CA). With random ID disabled (factory default) this is the 7-byte UID."""
        uid = self._tx("GetUID", bytes.fromhex("FFCA000000"))
        if len(uid) != 7:
            raise ApduError("GetUID (expected a 7-byte UID; random ID enabled?)", 0x6F00)
        return uid

    def select_ndef_app(self) -> None:
        self._tx("SelectNdefApp", bytes([0x00, 0xA4, 0x04, 0x0C, len(NDEF_APP_DF_NAME)]) + NDEF_APP_DF_NAME + b"\x00")

    def select_ndef_file(self) -> None:
        self._tx("SelectNdefFile", bytes([0x00, 0xA4, 0x00, 0x0C, 0x02]) + NDEF_FILE_ID)

    def update_binary(self, offset: int, data: bytes) -> None:
        for start in range(0, len(data), WRITE_CHUNK):
            chunk = data[start : start + WRITE_CHUNK]
            pos = offset + start
            self._tx("UpdateBinary", bytes([0x00, 0xD6, pos >> 8, pos & 0xFF, len(chunk)]) + chunk)

    def read_binary(self, offset: int, length: int) -> bytes:
        if not 1 <= length <= 255:
            raise ValueError("read length must be 1..255")
        data = self._tx("ReadBinary", bytes([0x00, 0xB0, offset >> 8, offset & 0xFF, length]))
        if len(data) != length:
            raise ApduError("ReadBinary (short read)", 0x6282)
        return data


    # --- Native commands ------------------------------------------------------------------

    def authenticate_ev2_first(self, key_no: int, key: bytes, rnd_a: bytes | None = None) -> SecureSession:
        """AuthenticateEV2First (AN12196 section 5.6, Table 14)."""
        rnd_a = rnd_a if rnd_a is not None else self._random(16)
        try:
            enc_rnd_b = self._tx(
                "AuthenticateEV2First", bytes([0x90, 0x71, 0x00, 0x00, 0x02, key_no, 0x00, 0x00]), (SW_ADDITIONAL_FRAME,)
            )
            if len(enc_rnd_b) != 16:
                raise AuthenticationError("unexpected AuthenticateEV2First response length")
            rnd_b = aes_cbc_decrypt(key, ZERO_IV, enc_rnd_b)
            part2 = aes_cbc_encrypt(key, ZERO_IV, rnd_a + rotate_left(rnd_b))
            enc_resp = self._tx("AuthenticateEV2First part 2", bytes([0x90, 0xAF, 0x00, 0x00, 0x20]) + part2 + b"\x00", (SW_DESFIRE_OK,))
        except ApduError as exc:
            if exc.sw == SW_AUTHENTICATION_ERROR:
                raise AuthenticationError(f"wrong key for key slot {key_no}") from None
            raise
        if len(enc_resp) != 32:
            raise AuthenticationError("unexpected AuthenticateEV2First part 2 response length")
        plain = aes_cbc_decrypt(key, ZERO_IV, enc_resp)
        ti, rnd_a_rot = plain[0:4], plain[4:20]
        if not hmac.compare_digest(rnd_a_rot, rotate_left(rnd_a)):
            raise AuthenticationError("tag failed to prove knowledge of the key")
        sv1, sv2 = session_vectors(rnd_a, rnd_b)
        return SecureSession(key_no=key_no, ti=ti, ses_enc=aes_cmac(key, sv1), ses_mac=aes_cmac(key, sv2))

    def change_file_settings(self, session: SecureSession, file_no: int, settings: bytes) -> None:
        """ChangeFileSettings in CommMode.Full (AN12196 section 5.9, Table 18)."""
        data, sw = self._t.transmit(session.wrap_full(0x5F, bytes([file_no]), settings))
        if sw != SW_DESFIRE_OK:
            raise ApduError("ChangeFileSettings", sw)
        session.check_response(data, sw)

    def change_key(self, session: SecureSession, key_no: int, old_key: bytes, new_key: bytes, version: int) -> None:
        """ChangeKey (AN12196 section 5.16). Changing the authenticated key ends the session."""
        if not 0 <= version <= 0xFF:
            raise ValueError("key version must be one byte")
        if key_no == session.key_no:
            key_data = bytes(new_key) + bytes([version])
        else:
            xored = bytes(a ^ b for a, b in zip(old_key, new_key))
            key_data = xored + bytes([version]) + crc32_nxp(new_key)
        data, sw = self._t.transmit(session.wrap_full(0xC4, bytes([key_no]), key_data))
        if sw != SW_DESFIRE_OK:
            raise ApduError(f"ChangeKey (slot {key_no})", sw)
        if key_no == session.key_no:
            session.cmd_ctr = -1  # the tag dropped the session; any further use is a bug
        else:
            session.check_response(data, sw)
