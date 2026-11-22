import pytest

from ntag424_encoder.ndef import build_sun_ndef, parse_uri_record, sdm_file_settings, validate_tag_url


def test_reproduces_an12196_table18_offsets_and_settings():
    # AN12196 section 5.9 / Table 18 configures https://choose.url.com/ntag424?e=<picc>&c=<cmac>:
    # ENCPICCDataOffset 0x20, SDMMACInputOffset = SDMMACOffset = 0x43, command data 4000E0C1F121200000430000430000.
    layout = build_sun_ndef("https://choose.url.com/ntag424", picc_param="e", cmac_param="c")
    assert layout.picc_offset == 0x20
    assert layout.mac_offset == layout.mac_input_offset == 0x43
    assert sdm_file_settings(layout).hex().upper() == "4000E0C1F121200000430000430000"


def test_layout_points_at_the_placeholders():
    layout = build_sun_ndef("https://tags.example.com/t/AbC123xyz")
    data = layout.file_data
    assert int.from_bytes(data[:2], "big") == len(data) - 2
    assert data[layout.picc_offset - 6 : layout.picc_offset] == b"?picc="
    assert data[layout.picc_offset : layout.picc_offset + 32] == b"0" * 32
    assert data[layout.mac_offset - 6 : layout.mac_offset] == b"&cmac="
    assert data[layout.mac_offset : layout.mac_offset + 16] == b"0" * 16
    assert parse_uri_record(data) == layout.url_template
    assert layout.url_template == "https://tags.example.com/t/AbC123xyz?picc=" + "0" * 32 + "&cmac=" + "0" * 16


def test_http_prefix_for_local_development():
    layout = build_sun_ndef("http://localhost:3000/t/tag_0001")
    assert layout.file_data[6] == 0x03
    assert parse_uri_record(layout.file_data).startswith("http://localhost:3000/t/tag_0001?picc=")


@pytest.mark.parametrize(
    "url",
    [
        "https://x.example/t/abcd?x=1",
        "https://x.example/t/abcd#frag",
        "https://x.example/q/abcd",
        "javascript:alert(1)//t/abcd",
        "https://x.example/t/ab",
        "https://x.example/t/abcd/",
        "https://x.example/t/äbcd",
    ],
)
def test_rejects_unexpected_urls(url):
    with pytest.raises(ValueError):
        validate_tag_url(url)


def test_rejects_urls_that_do_not_fit():
    with pytest.raises(ValueError):
        build_sun_ndef("https://example.com/" + "a" * 200 + "/t/abcd")
