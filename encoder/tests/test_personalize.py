"""End-to-end personalization against the simulated tag."""

from urllib.parse import parse_qs, urlsplit

import pytest

from ntag424_encoder.commands import Ntag424
from ntag424_encoder.crypto import FACTORY_KEY, derive_all_keys, derive_system_key, verify_sun
from ntag424_encoder.ndef import parse_uri_record
from ntag424_encoder.personalize import EncodeError, key_version_byte, personalize_tag
from ntag_sim import DeterministicRng, SimulatedNtag424

MASTER = bytes.fromhex("000102030405060708090A0B0C0D0E0F")
UID = bytes.fromhex("04A1B2C3D4E5F6")
URL = "https://tags.example.com/t/tag_AbC123"


def make_tag(uid=UID):
    sim = SimulatedNtag424(uid, DeterministicRng(b"tag-" + uid))
    return sim, Ntag424(sim, random_bytes=DeterministicRng(b"host-" + uid))


def tap(sim):
    """What a phone does: select, read the NDEF file, open the URL."""
    sim.transmit(bytes.fromhex("00A4040C07D276000085010100"))
    sim.transmit(bytes.fromhex("00A4000C02E104"))
    data, _ = sim.transmit(bytes([0x00, 0xB0, 0, 0, 0]))
    return parse_uri_record(data)


def test_personalizes_a_blank_tag():
    sim, tag = make_tag()
    result = personalize_tag(tag, MASTER, URL, master_key_version=3)
    assert result.uid == UID.hex().upper()
    assert result.counter == 1

    keys = derive_all_keys(MASTER, UID)
    assert sim.keys == [keys[s] for s in range(5)]
    assert sim.key_versions == [3] * 5
    assert sim.access == {"rw": 0, "change": 0, "read": 0xE, "write": 0}

    # Subsequent taps verify with the server-side rule, and the counter increases.
    for expected in (2, 3):
        q = parse_qs(urlsplit(tap(sim)).query)
        picc = verify_sun(q["picc"][0], q["cmac"][0], derive_system_key(MASTER, 2), lambda uid: keys[1])
        assert picc is not None and picc.uid == UID and picc.counter == expected


def test_never_sends_a_plaintext_key():
    sim, tag = make_tag()
    personalize_tag(tag, MASTER, URL)
    wire = b"".join(sim.log)
    for key in derive_all_keys(MASTER, UID).values():
        assert key not in wire


def test_refuses_an_already_encoded_tag():
    sim, tag = make_tag()
    personalize_tag(tag, MASTER, URL)
    keys_before = list(sim.keys)
    with pytest.raises(EncodeError) as exc:
        personalize_tag(Ntag424(sim), MASTER, URL)
    assert exc.value.status == "not_blank"
    assert sim.keys == keys_before


def test_refuses_a_tag_with_unknown_key0():
    sim, tag = make_tag()
    sim.keys[0] = bytes([9]) * 16
    with pytest.raises(EncodeError) as exc:
        personalize_tag(tag, MASTER, URL)
    assert exc.value.status == "not_blank"


def test_reports_partial_encoding_when_a_command_fails():
    sim, tag = make_tag()
    sim.fail_on.add(0xC4)  # ChangeKey fails
    with pytest.raises(EncodeError) as exc:
        personalize_tag(tag, MASTER, URL)
    assert exc.value.status == "partial"
    assert sim.keys[0] == FACTORY_KEY  # key 0 is changed last, so the tag is still recoverable


def test_detects_a_tag_that_mirrors_a_wrong_mac():
    sim, tag = make_tag()
    original = sim._sdm_view

    def corrupted():
        view = bytearray(original())
        view[sim.sdm["mac"]] = ord("0") if view[sim.sdm["mac"]] != ord("0") else ord("1")
        return bytes(view)

    sim._sdm_view = corrupted
    with pytest.raises(EncodeError) as exc:
        personalize_tag(tag, MASTER, URL)
    assert exc.value.status == "verify_failed"


def test_error_messages_contain_no_key_material():
    sim, tag = make_tag()
    sim.fail_on.add(0xC4)
    with pytest.raises(EncodeError) as exc:
        personalize_tag(tag, MASTER, URL)
    text = str(exc.value).lower()
    for key in derive_all_keys(MASTER, UID).values():
        assert key.hex() not in text
    assert MASTER.hex() not in text


def test_key_version_byte():
    assert key_version_byte(1) == 1
    assert key_version_byte(255) == 255
    assert key_version_byte(256) == 1
