"""Official test vectors for the encoder's crypto (same sources as tests/unit/ntag424-*.test.ts).

- NIST SP 800-38B (May 2005), Appendix D.1, AES-128 CMAC examples
  https://www.govinfo.gov/content/pkg/GOVPUB-C13-f05b7969a96dff6e1fae82057f5c211d/pdf/GOVPUB-C13-f05b7969a96dff6e1fae82057f5c211d.pdf
- NXP AN10922 "Symmetric key diversifications", section 2.2.1 (AES-128 example)
  https://www.nxp.com/docs/en/application-note/AN10922.pdf
- NXP AN12196 "NTAG 424 DNA and NTAG 424 DNA TagTamper features and hints", sections 3.4.2.2 / 3.4.4.2
  https://www.nxp.jp/docs/en/application-note/AN12196.pdf
"""

import pytest

from ntag424_encoder.crypto import (
    aes_cmac,
    an10922_diversify_aes128,
    crc32_nxp,
    decrypt_picc_data,
    derive_all_keys,
    derive_per_tag_key,
    derive_system_key,
    pad_iso9797_m2,
    sdm_mac,
    sdm_session_mac_key,
    truncate_mac,
    verify_sun,
)

h = bytes.fromhex
ZERO = bytes(16)

NIST_KEY = h("2b7e151628aed2a6abf7158809cf4f3c")
NIST_M = h(
    "6bc1bee22e409f96e93d7e117393172a"
    "ae2d8a571e03ac9c9eb76fac45af8e51"
    "30c81c46a35ce411e5fbc1191a0a52ef"
    "f69f2445df4f9b17ad2b417be66c3710"
)


@pytest.mark.parametrize(
    "mlen,tag",
    [
        (0, "bb1d6929e95937287fa37d129b756746"),
        (16, "070a16b46b4d4144f79bdd9dd04a287c"),
        (40, "dfa66747de9ae63030ca32611497c827"),
        (64, "51f0bebf7e3b9d92fc49741779363cfe"),
    ],
)
def test_nist_sp800_38b_aes128_cmac(mlen, tag):
    assert aes_cmac(NIST_KEY, NIST_M[:mlen]).hex() == tag


def test_an10922_aes128_example():
    m = h("04782E21801D80") + h("3042F5") + h("4E585020416275")
    assert an10922_diversify_aes128(h("00112233445566778899AABBCCDDEEFF"), m) == h("A8DD63A3B89D54B37CA802473FDA9175")


def test_an10922_input_length_limits():
    with pytest.raises(ValueError):
        an10922_diversify_aes128(ZERO, b"")
    with pytest.raises(ValueError):
        an10922_diversify_aes128(ZERO, bytes(32))


def test_an12196_sun_example():
    # https://ntag.nxp.com/424?e=EF963FF7828658A599F3041510671E88&c=94EED9EE65337086, all keys 00..00
    picc = decrypt_picc_data(ZERO, h("EF963FF7828658A599F3041510671E88"))
    assert picc is not None
    assert picc.uid == h("04DE5F1EACC040")
    assert picc.counter_bytes == h("3D0000") and picc.counter == 61
    ses = sdm_session_mac_key(ZERO, picc.uid, picc.counter_bytes)
    assert ses == h("3FB5F6E3A807A03D5E3570ACE393776F")
    assert sdm_mac(ses) == h("94EED9EE65337086")
    ok = verify_sun("EF963FF7828658A599F3041510671E88", "94EED9EE65337086", ZERO, lambda uid: ZERO)
    assert ok is not None and ok.counter == 61


def test_an12196_table5_mac_with_input():
    ses = sdm_session_mac_key(ZERO, h("04958CAA5C5E80"), h("080000"))
    assert ses == h("3ED0920E5E6A0320D823D5987FEAFBB1")
    data = b"CEE9A53E3E463EF1F459635736738962&cmac="
    assert aes_cmac(ses, data) == h("81EC45C175E72FF6FAC61BC7AB3BAEF6")
    assert truncate_mac(aes_cmac(ses, data)) == h("ECC1E7F6C6C73BF6")


@pytest.mark.parametrize(
    "picc,cmac,meta,file",
    [
        ("EF963FF7828658A599F3041510671E88", "94EED9EE65337087", ZERO, ZERO),  # tampered cmac
        ("EF963FF7828658A599F3041510671E88", "94EED9EE65337086", ZERO, bytes([1]) * 16),  # wrong MAC key
        ("EF963FF7828658A599F3041510671E88", "94EED9EE65337086", bytes([1]) * 16, ZERO),  # wrong meta key
        ("EF963FF7828658A599F3041510671E8", "94EED9EE65337086", ZERO, ZERO),  # short picc
        ("EF963FF7828658A599F3041510671E88", "94EED9EE6533708", ZERO, ZERO),  # short cmac
        ("XF963FF7828658A599F3041510671E88", "94EED9EE65337086", ZERO, ZERO),  # bad hex
    ],
)
def test_verify_sun_rejects(picc, cmac, meta, file):
    assert verify_sun(picc, cmac, meta, lambda uid: file) is None


def test_crc32_matches_an12196_table25():
    assert crc32_nxp(h("F3847D627727ED3BC9C4CC050489B966")) == h("789DFADC")


def test_padding():
    assert pad_iso9797_m2(b"") == b"\x80" + bytes(15)
    assert len(pad_iso9797_m2(bytes(16))) == 32
    assert pad_iso9797_m2(bytes(15)) == bytes(15) + b"\x80"


def test_project_derivation_properties():
    master = h("000102030405060708090A0B0C0D0E0F")
    a = derive_all_keys(master, h("04A1B2C3D4E5F6"))
    b = derive_all_keys(master, h("04A1B2C3D4E5F7"))
    assert len(set(a.values())) == 5
    assert a[2] == b[2] == derive_system_key(master, 2)  # shared meta-read key
    assert all(a[s] != b[s] for s in (0, 1, 3, 4))
    with pytest.raises(ValueError):
        derive_per_tag_key(master, h("04A1B2"), 1)
    with pytest.raises(ValueError):
        derive_per_tag_key(master, h("04A1B2C3D4E5F6"), 5)
