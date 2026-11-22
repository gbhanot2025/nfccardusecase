"""EV2 secure messaging against the AN12196 example exchanges (section 5, Tables 14, 18, 25, 26).

Source: https://www.nxp.jp/docs/en/application-note/AN12196.pdf
"""

import pytest

from ntag424_encoder.commands import Ntag424
from ntag424_encoder.secure import ResponseMacError, SecureSession, session_vectors

h = bytes.fromhex


class ScriptedTransport:
    """Asserts each C-APDU equals the documented one and replays the documented R-APDU."""

    def __init__(self, exchanges):
        self.exchanges = list(exchanges)

    def transmit(self, apdu):
        assert self.exchanges, "unexpected extra APDU"
        expected, response = self.exchanges.pop(0)
        assert apdu.hex().upper() == expected
        return h(response[:-4]), int(response[-4:], 16)


def test_table14_authenticate_ev2_first():
    t = ScriptedTransport(
        [
            ("9071000002000000", "A04C124213C186F22399D33AC2A3021591AF"),
            (
                "90AF00002035C3E05A752E0144BAC0DE51C1F22C56B34408A23D8AEA266CAB947EA8E0118D00",
                "3FA64DB5446D1F34CD6EA311167F5E4985B89690C04A05F17FA7AB2F081206639100",
            ),
        ]
    )
    s = Ntag424(t).authenticate_ev2_first(0, bytes(16), rnd_a=h("13C5DB8A5930439FC3DEF9A4C675360F"))
    assert not t.exchanges
    assert s.ti == h("9D00C4DF")
    assert s.ses_enc == h("1309C877509E5A215007FF0ED19CA564")
    assert s.ses_mac == h("4C6626F5E72EA694202139295C7A7FC7")
    assert s.cmd_ctr == 0


def test_table14_session_vectors():
    sv1, sv2 = session_vectors(h("13C5DB8A5930439FC3DEF9A4C675360F"), h("B9E2FC789B64BF237CCCAA20EC7E6E48"))
    assert sv1 == h("A55A0001008013C56268A548D8FBBF237CCCAA20EC7E6E48C3DEF9A4C675360F")
    assert sv2 == h("5AA50001008013C56268A548D8FBBF237CCCAA20EC7E6E48C3DEF9A4C675360F")


def test_authentication_detects_a_tag_without_the_key():
    from ntag424_encoder.commands import AuthenticationError

    t = ScriptedTransport(
        [
            ("9071000002000000", "A04C124213C186F22399D33AC2A3021591AF"),
            (
                "90AF00002035C3E05A752E0144BAC0DE51C1F22C56B34408A23D8AEA266CAB947EA8E0118D00",
                # RndA' corrupted: response from a fake tag that can't decrypt our challenge
                "00A64DB5446D1F34CD6EA311167F5E4985B89690C04A05F17FA7AB2F081206639100",
            ),
        ]
    )
    with pytest.raises(AuthenticationError):
        Ntag424(t).authenticate_ev2_first(0, bytes(16), rnd_a=h("13C5DB8A5930439FC3DEF9A4C675360F"))


def table14_session(ctr=1):
    return SecureSession(
        key_no=0,
        ti=h("9D00C4DF"),
        ses_enc=h("1309C877509E5A215007FF0ED19CA564"),
        ses_mac=h("4C6626F5E72EA694202139295C7A7FC7"),
        cmd_ctr=ctr,
    )


def test_table18_change_file_settings():
    s = table14_session(ctr=1)
    assert s.command_iv() == h("3E27082AB2ACC1EF55C57547934E9962")
    t = ScriptedTransport(
        [
            (
                "905F0000190261B6D97903566E84C3AE5274467E89EAD799B7C1A0EF7A0400",
                "57BFF87B1241E93D9100",  # response MACt over 00 || CmdCtr(0200) || TI
            )
        ]
    )
    Ntag424(t).change_file_settings(s, 0x02, h("4000E0C1F121200000430000430000"))
    assert s.cmd_ctr == 2


def test_table18_rejects_a_forged_response_mac():
    s = table14_session(ctr=1)
    t = ScriptedTransport(
        [("905F0000190261B6D97903566E84C3AE5274467E89EAD799B7C1A0EF7A0400", "57BFF87B1241E93E9100")]
    )
    with pytest.raises(ResponseMacError):
        Ntag424(t).change_file_settings(s, 0x02, h("4000E0C1F121200000430000430000"))


def table25_session(ctr):
    return SecureSession(
        key_no=0,
        ti=h("7614281A"),
        ses_enc=h("4CF3CB41A22583A61E89B158D252FC53"),
        ses_mac=h("5529860B2FC5FB6154B7F28361D30BF9"),
        cmd_ctr=ctr,
    )


def test_table25_change_key_other_slot():
    s = table25_session(ctr=2)
    assert s.command_iv() == h("307EDE1814707F30CFE603DD6CA62353")
    t = ScriptedTransport(
        [
            (
                "90C4000029022CF362B7BF4311FF3BE1DAA295E8C68DE09050560D19B9E16C2393AE9CD1FAC75D0CE20BCD1D06E600",
                "203BB55D1089D5879100",
            )
        ]
    )
    Ntag424(t).change_key(s, 0x02, bytes(16), h("F3847D627727ED3BC9C4CC050489B966"), version=1)
    assert s.cmd_ctr == 3


def test_table26_change_authentication_key():
    s = table25_session(ctr=3)
    assert s.command_iv() == h("01602D579423B2797BE8B478B0B4D27B")
    t = ScriptedTransport(
        [
            (
                "90C400002900C0EB4DEEFEDDF0B513A03A95A75491818580503190D4D05053FF75668A01D6FDA6610234BDED643200",
                "9100",
            )
        ]
    )
    Ntag424(t).change_key(s, 0x00, bytes(16), h("5004BF991F408672B1EF00F08F9E8647"), version=1)


def test_session_repr_hides_keys():
    s = table14_session()
    assert s.ses_enc.hex() not in repr(s).lower()
    assert s.ses_mac.hex() not in repr(s).lower()
