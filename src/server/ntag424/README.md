# NTAG 424 DNA tap verification (SUN / SDM)

Pure server-side functions that prove a `/t/{tagId}` URL was produced by one of our tags. Nothing here is
wired into a route yet: the `/t/{tagId}` handler (milestone 2) calls it.

| File           | What it does                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `cmac.ts`      | AES-128 CMAC (NIST SP 800-38B) and NXP MAC truncation, on `node:crypto` only                    |
| `diversify.ts` | AN10922 AES-128 key diversification and our key layout (`deriveTagKeys(masterKey, uid)`)        |
| `sun.ts`       | `verifyTap({ picc, cmac }, keys)`: Zod validation, PICC decryption, SV2 session key, CMAC check |
| `counter.ts`   | `acceptTapCounter(db, tagId, counter)`: atomic, forward-only `last_counter` update              |
| `keys.ts`      | `readMasterKey()`: master key from OpenBao KV v2 over HTTP (`fetch` injectable)                 |

## The URL the encoder writes

```
${APP_BASE_URL}/t/{tagId}?picc={32 hex}&cmac={16 hex}
```

- The batch CSV's `nfc_url` is `${APP_BASE_URL}/t/{tagId}`; the encoder appends `?picc=<32 zeros>&cmac=<16 zeros>`
  and the tag overwrites the zeros on every read (uppercase ASCII hex).
- NDEF file layout: `NLEN(2) | D1 01 <len> 55 | <URI prefix code> | <URI text>`. All SDM offsets count from the
  first byte of the file, so the URI text starts at offset 7. For a given URL:
  - `PICCDataOffset` = offset of the first char after `?picc=`
  - `SDMMACInputOffset` = `SDMMACOffset` = offset of the first char after `&cmac=` (empty MAC input, as in AN12196
    Table 4)
  - Example from AN12196 Table 18 (`https://choose.url.com/ntag424?e=…&c=…`): 0x20, 0x43, 0x43. The encoder's tests
    reproduce those exact bytes.
- File settings (`ChangeFileSettings` on file 02): SDM on, CommMode plain, Read free / Write, RW, Change = key 0;
  SDMOptions `C1` (UID + counter mirror, ASCII); SDMMetaRead = key 2, SDMFileRead = key 1, SDMCtrRet = key 1.

## Keys

One AES-128 master key lives in OpenBao (`secret/ntag424/master-key`, field `key`, 32 hex chars). Every tag key
is derived from it with NXP AN10922 (`CMAC(master, 0x01 || M)`), system identifier `TagPlatformNTAG424v1`:

| Slot | Purpose                        | Diversification input `M`                   | Who needs it     |
| ---- | ------------------------------ | ------------------------------------------- | ---------------- |
| 0    | Application master key         | `"T" ‖ UID(7) ‖ 0x00 ‖ system id`           | encoder only     |
| 1    | SDM file read (signs the CMAC) | `"T" ‖ UID(7) ‖ 0x01 ‖ system id`           | server + encoder |
| 2    | SDM meta read (encrypts PICC)  | `"S" ‖ 0x02 ‖ system id` (**same for all**) | server + encoder |
| 3, 4 | Unused, changed from default   | `"T" ‖ UID(7) ‖ slot ‖ system id`           | encoder only     |

The meta-read key can't depend on the UID because the server has to decrypt the PICC data to learn the UID. It
only hides UID and counter from onlookers; authenticity comes from the per-tag MAC key.
`tests/fixtures/ntag424-vectors.json` pins this scheme for both the TypeScript and the Python implementation.

Key versions: each OpenBao write creates a new KV version. The encoder records `key_ref` =
`openbao:ntag424/master-key@<version>` per tag; `parseMasterKeyRef()` turns it back into a version for
`readMasterKey({ version })`, so rotating the master key never breaks tags already shipped.

## What the `/t/{tagId}` route must do (milestone 2)

`verifyTap` only proves the tag produced these bytes. The caller must still:

1. Parse `tagId` and look up the tag. Read `picc` and `cmac` from the query string (pass them as strings; arrays
   are rejected).
2. Load the master key for the tag's `key_ref` (`readMasterKey({ version })`) and call
   `verifyTap({ picc, cmac }, keyProviderFromMasterKey(master.key))`. On `ok: false`, treat the visit as
   unverified (e.g. like a QR scan: read-only page, no claiming) and log only the `reason`, never the params.
3. Check the returned `uid` equals the UID stored for that tag at encoding time (otherwise a valid tap from tag A
   could be pasted onto `/t/B`). Storing the UID per tag needs a schema change and the encoder upload; both are
   outside this module.
4. Reject if `counter <= tags.last_counter`, and record it atomically with
   `acceptTapCounter(db, tagId, counter)`, which runs
   `UPDATE tags SET last_counter = $c WHERE id = $id AND last_counter < $c` and returns `false` for replays.
   Only a `true` result makes the tap "verified" (e.g. allowed to start a claim).

Note the encoder's own verification read uses counter 1, so the first customer tap arrives with counter 2.
