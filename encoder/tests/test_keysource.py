import io
import json
import urllib.error

import pytest

from ntag424_encoder.keysource import KeySourceError, load_from_env, load_from_openbao

KEY = "00112233445566778899aabbccddeeff"
TOKEN = "s.token-that-must-not-leak"


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def opener_returning(body, seen=None):
    def opener(request, timeout):
        if seen is not None:
            seen.append(request)
        return FakeResponse(json.dumps(body).encode())

    return opener


def test_reads_kv2_secret():
    seen = []
    mk = load_from_openbao(
        "http://bao:8200", TOKEN, version=2,
        opener=opener_returning({"data": {"data": {"key": KEY}, "metadata": {"version": 2}}}, seen),
    )
    assert mk.key == bytes.fromhex(KEY) and mk.version == 2
    assert mk.key_ref == "openbao:ntag424/master-key@2"
    assert seen[0].full_url == "http://bao:8200/v1/secret/data/ntag424/master-key?version=2"
    assert seen[0].get_header("X-vault-token") == TOKEN
    assert KEY not in repr(mk)


@pytest.mark.parametrize(
    "body",
    [
        {"data": {"data": {"key": KEY[:-2]}, "metadata": {"version": 1}}},
        {"data": {"data": {"nope": KEY}, "metadata": {"version": 1}}},
        {"data": {"data": {"key": KEY}, "metadata": {}}},
        [],
    ],
)
def test_rejects_bad_secrets_without_leaking(body):
    with pytest.raises(KeySourceError) as exc:
        load_from_openbao("http://bao:8200", TOKEN, opener=opener_returning(body))
    assert KEY[:20] not in str(exc.value) and TOKEN not in str(exc.value)


def test_http_errors_do_not_leak_the_token():
    def opener(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 403, f"denied {TOKEN}", {}, None)

    with pytest.raises(KeySourceError, match="403") as exc:
        load_from_openbao("http://bao:8200", TOKEN, opener=opener)
    assert TOKEN not in str(exc.value)


@pytest.mark.parametrize("kwargs", [{"addr": ""}, {"addr": "file:///etc/passwd"}, {"path": "../sys"}, {"version": 0}])
def test_rejects_bad_configuration(kwargs):
    args = {"addr": "http://bao:8200", "token": TOKEN, **kwargs}
    with pytest.raises(KeySourceError):
        load_from_openbao(opener=opener_returning({}), **args)


def test_env_key_for_development():
    mk = load_from_env({"NTAG424_MASTER_KEY": KEY})
    assert mk.key_ref == "env:dev"
    with pytest.raises(KeySourceError):
        load_from_env({"NTAG424_MASTER_KEY": "short"})
