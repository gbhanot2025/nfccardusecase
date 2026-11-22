"""Where the master key comes from: OpenBao KV v2 (default) or an env var (development only).

The key is never printed, logged or written to any file. Error messages carry no key or token.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Callable

DEFAULT_MOUNT = "secret"
DEFAULT_PATH = "ntag424/master-key"
_PATH = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$")
_KEY = re.compile(r"^[0-9A-Fa-f]{32}$")


class KeySourceError(Exception):
    pass


@dataclass(frozen=True)
class MasterKey:
    key: bytes = field(repr=False)
    version: int
    key_ref: str  # stored with the tag (tags.key_ref); same format as src/server/ntag424/keys.ts


Opener = Callable[[urllib.request.Request, float], object]


def _default_open(request: urllib.request.Request, timeout: float):
    return urllib.request.urlopen(request, timeout=timeout)  # noqa: S310 - URL scheme checked below


def load_from_openbao(
    addr: str,
    token: str,
    mount: str = DEFAULT_MOUNT,
    path: str = DEFAULT_PATH,
    version: int | None = None,
    opener: Opener = _default_open,
) -> MasterKey:
    if not addr or not token:
        raise KeySourceError("OPENBAO_ADDR and OPENBAO_TOKEN must be set")
    if not addr.startswith(("https://", "http://")):
        raise KeySourceError("OPENBAO_ADDR must be an http(s) URL")
    if not _PATH.match(mount) or not _PATH.match(path):
        raise KeySourceError("invalid OpenBao path")
    if version is not None and version < 1:
        raise KeySourceError("invalid key version")

    url = f"{addr.rstrip('/')}/v1/{mount}/data/{path}" + (f"?version={version}" if version else "")
    request = urllib.request.Request(url, headers={"X-Vault-Token": token, "Accept": "application/json"})
    try:
        with opener(request, 10.0) as response:  # type: ignore[attr-defined]
            body = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raise KeySourceError(f"OpenBao returned HTTP {exc.code}") from None
    except (urllib.error.URLError, OSError, ValueError):
        raise KeySourceError("OpenBao request failed") from None

    try:
        key_hex = body["data"]["data"]["key"]
        ver = body["data"]["metadata"]["version"]
    except (KeyError, TypeError):
        raise KeySourceError("OpenBao secret has an unexpected shape") from None
    if not isinstance(key_hex, str) or not _KEY.match(key_hex) or not isinstance(ver, int) or ver < 1:
        raise KeySourceError("OpenBao secret has an unexpected shape")
    return MasterKey(key=bytes.fromhex(key_hex), version=ver, key_ref=f"openbao:{path}@{ver}")


def load_from_env(environ: dict[str, str] | None = None) -> MasterKey:
    """Development only: NTAG424_MASTER_KEY=<32 hex>. Tags encoded this way are marked key_ref=env:dev."""
    value = (environ if environ is not None else os.environ).get("NTAG424_MASTER_KEY", "")
    if not _KEY.match(value):
        raise KeySourceError("NTAG424_MASTER_KEY must be 32 hex characters")
    return MasterKey(key=bytes.fromhex(value), version=1, key_ref="env:dev")
