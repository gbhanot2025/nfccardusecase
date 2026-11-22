# NTAG 424 DNA encoder

Command-line tool that turns factory-fresh NTAG 424 DNA tags into tags for the platform. For each row of an admin
batch CSV it:

1. writes the NDEF URL `{nfc_url}?picc=<32 zeros>&cmac=<16 zeros>`,
2. authenticates with the factory key 0 (`AuthenticateEV2First`),
3. enables SUN/SDM mirroring on the NDEF file (`ChangeFileSettings`: encrypted UID + read counter, CMAC) and makes
   the file read-only for everyone without key 0,
4. replaces all five application keys with keys derived from the master key (NXP AN10922, see
   `src/server/ntag424/README.md`) — key 0 last,
5. reads the URL back and verifies the SUN CMAC exactly like the server does, then re-authenticates with the new
   key 0,
6. appends `tag_id, uid, encoded_at, status, key_ref` to the results CSV.

Claim codes in the batch CSV are never read into the output, printed or logged. Keys are never printed or written.

## Safety: changing keys is irreversible

After encoding, every key on the tag is derived from the OpenBao master key. **If the master key is lost, the
encoded tags can never be reconfigured and their taps can never be verified** — they become scrap. Before
encoding a real batch:

- make sure OpenBao is a real (not `-dev`, in-memory) server and its storage and unseal keys are backed up;
- keep the master key version used (`key_ref` column); old versions must stay readable in OpenBao;
- try one tag first and tap it with a phone.

A tag that fails half-way (`partial`) still has the factory key 0 (key 0 is changed last) and all other keys are
deterministic from the UID, so nothing is lost, but the CLI won't retry it automatically: set it aside.

## Setup

Requires Python 3.11+ and an ACS ACR1252U (any PC/SC reader should work).

```bash
cd encoder
python3 -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e ".[reader,dev]"
```

### Reader drivers

The ACR1252U is a CCID reader. It shows up as two PC/SC readers, `… PICC 0` (contactless, the one we use) and
`… SAM 0`; the CLI picks the PICC one (`--reader` changes the name filter).

- **macOS:** works with the built-in CCID driver and PC/SC service; no install needed. `pip install pyscard` uses
  a prebuilt wheel. ACS's own macOS driver is only needed if the reader isn't listed.
- **Windows:** Windows installs its CCID driver automatically; install the ACS ACR1252U driver from acs.com.hk if
  the reader isn't listed. Make sure the "Smart Card" service is running.
- **Linux (Debian/Ubuntu):** `sudo apt install pcscd libccid pcsc-tools libpcsclite-dev swig` then
  `sudo systemctl enable --now pcscd`. `pcsc_scan` should list the reader and show a tag when you tap one
  (`libpcsclite-dev` and `swig` are only needed if pip has to build pyscard from source).

## Master key

Create it once in OpenBao (KV v2 at `secret/`), from a machine you trust:

```bash
export BAO_ADDR=http://localhost:8200 BAO_TOKEN=...
bao kv put secret/ntag424/master-key key="$(openssl rand -hex 16)"
```

The encoder reads `OPENBAO_ADDR` / `OPENBAO_TOKEN` (same names as the server; override the path with
`NTAG424_KV_MOUNT` / `NTAG424_KV_PATH`, the version with `--key-version`). Use a token whose policy only allows
reading that path.

For development only, `--key-source env` reads `NTAG424_MASTER_KEY` (32 hex chars) instead; such tags get
`key_ref=env:dev` and won't verify in production.

## Usage

```bash
ntag424-encode tag-batch-2026-11.csv --base-url https://your-domain.example
```

- Input: the admin batch CSV (`batch_id, tag_id, public_code, nfc_url, qr_url, claim_code`). Only `tag_id` and
  `nfc_url` are used; every `nfc_url` must be exactly `{base-url}/t/{tag_id}` (defaults to `$APP_BASE_URL`).
- You confirm once by typing `ENCODE`, then for each tag: place a blank tag on the reader, press Enter, wait for
  `OK`, remove the tag. `s` skips a row, `q` stops.
- Output: `<batch>.encoded.csv` (or `-o`). Rows are appended and flushed one by one; re-running the same command
  resumes with the tags not yet `ok`. Tapping a tag that was already encoded in this batch is refused.
- Statuses: `ok`, `not_blank` (already encoded or unknown key 0), `partial` (failed mid-way, set aside),
  `verify_failed`, `error`.

Uploading the results (UID + key_ref per tag) to the server isn't built yet: see `src/ntag424_encoder/upload.py`.
Hand the results CSV to an admin for now.

## Tests

```bash
pip install -e ".[dev]"   # pyscard not needed
pytest
```

Tests use NIST SP 800-38B CMAC examples, the NXP AN10922 diversification example and the NXP AN12196 example
exchanges (AuthenticateEV2First, ChangeFileSettings, ChangeKey, SUN decryption/CMAC), plus an NTAG 424 DNA
simulator (`tests/ntag_sim.py`) for full end-to-end runs. `tests/test_vectors_shared.py` regenerates
`../tests/fixtures/ntag424-vectors.json`, which the TypeScript verifier also checks, so the two implementations
can't drift apart.

**Not yet tested on real hardware.** Things to check on the first real tags: the ACR1252U's handling of the
`UpdateBinary` chunk size, the reader name filter, and that iOS/Android open the URL from a locked screen.
