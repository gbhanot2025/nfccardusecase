# NFC Tag Platform

Customers activate a shipped NFC/QR tag (card, pet collar tag, sticker, keychain) with the claim code from the
packaging and link it to one profile: **Digital Card, Lost Pet, Lost Device or Lost ID/Wallet**.
Product spec: [`docs/spec.md`](docs/spec.md). Working rules for Claude Code: [`CLAUDE.md`](CLAUDE.md).

## Status

**Milestone 1 (foundation) is done:** accounts with email verification, password reset, two-step verification
(authenticator app + backup codes) and passkeys; the full database schema; strict security headers; tests and CI.

**Milestone 2 (tags and claiming) is done:** admins generate tag batches (random IDs, QR codes, claim codes stored only
as Argon2 hashes) with a one-time printable label sheet and CSV; `/t/{tagId}` routes by tag state; customers claim a
tag with its claim code (rate-limited) and choose a profile type, or move an existing profile onto a replacement tag;
owners can turn tags off and on; admins can disable tags and reissue lost claim codes.

**Milestone 3 (profiles) is done:** genuine NFC taps are verified (NTAG 424 SUN: signature, chip UID, forward-only
counter); owners edit their profile from the dashboard (business card, lost pet, lost device, lost wallet/ID) and
turn lost mode on/off; `/t` and `/q` show the real public pages; business cards have "Save contact" (vCard 3.0).
Photo uploads and the finder relay come in milestone 4.

## Run it locally

Requires Node 22+ and Docker.

```bash
npm install
cp .env.example .env
# put a random value in BETTER_AUTH_SECRET:  openssl rand -base64 48
docker compose up -d          # Postgres, Mailpit, S3 storage, OpenBao (dev)
npm run db:migrate
npm run dev                   # http://localhost:3000
```

Emails (verification, password reset) land in Mailpit at http://localhost:8025.

To make yourself an admin after signing up and verifying your email:

```bash
npm run admin:grant -- you@example.com
```

## Making tags (admin)

1. Make yourself an admin (above) and turn on two-step verification: the admin area requires it.
2. Open http://localhost:3000/admin → **New batch**: name, form factor, allowed profile types, quantity (max 500).
3. **Save the claim codes immediately**: download the CSV and/or print the labels (QR code + claim code per tag).
   Claim codes are stored only as hashes and are never shown again. If they're lost before shipping, use
   **Reissue claim codes** on the batch page (unclaimed tags get new codes; the old ones stop working).
4. Encode the tags with the encoder (`encoder/README.md`), then on the batch page **Import results** with the
   encoder's results CSV. This links each tag to its chip UID; until then taps can't be verified.
5. To try claiming without a physical tag, open a tag's NFC link (`/t/{tag_id}` from the CSV) and enter its claim code.

| Link              | Who uses it                                  | What it does                                  |
| ----------------- | -------------------------------------------- | --------------------------------------------- |
| `/t/{tagId}`      | NFC tap (written to the chip by the encoder) | Activation if unclaimed, else the public page |
| `/q/{publicCode}` | Printed QR code                              | Public page only: never claims or edits       |
| `/activate`       | Customers whose phone has no NFC             | Activate with the printed code + claim code   |
| `/admin`          | Admins (with 2FA)                            | Batches, tag search, disable/enable           |

### How taps are verified

A genuine tap opens `/t/{tagId}?picc=…&cmac=…`. The server decrypts `picc` (chip UID + tap counter), checks the
`cmac` signature with that chip's own key (derived from the master key in OpenBao), checks the UID belongs to this
tag, and only accepts a counter higher than the last one seen. Verified taps show "✓ Genuine tag" and are recorded
as scans; copied or replayed links still show the public page but are not counted. Claiming never depends on it (the
claim code is the secret).

## Production

`docker-compose.prod.yml` (Caddy HTTPS, app, Postgres, OpenBao, SeaweedFS, nightly backups) and the step-by-step
[runbook](docs/runbook.md): first-time setup, deploys, OpenBao unseal, backups/restore, monitoring, incidents.

## Tests

| Command            | What it covers                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm test`         | Unit tests (config validation, CSP, redirects, email escaping) and database rules (needs `TEST_DATABASE_URL`)                |
| `npm run test:e2e` | Browser tests on a production build, desktop + Android: sign-up, verification, login, 2FA, password reset, no CSP violations |

First run of the browser tests: `npx playwright install chromium`.
A separate database is used for integration tests and is **wiped on every run**:

```bash
docker compose exec postgres createdb -U tagplatform tagplatform_test
```

## Security already in place

- Email must be verified before login; passwords 12–128 characters; sessions revoked on password reset.
- Login, sign-up, reset and 2FA endpoints are rate-limited (stored in the database).
- Same error for unknown email and wrong password; sign-up with an existing email silently notifies the real owner.
- Cross-site requests to the auth API are rejected (origin check).
- Nonce-based Content-Security-Policy, HSTS, no framing, strict referrer and permissions policies.
- The app refuses to start in production without HTTPS, SMTP and rate limiting.
- Database constraints back up the rules: one profile per tag, active tags must have an owner, unique public codes.
- Claim codes: 50-bit random, stored as Argon2id hashes, shown once; claim attempts are limited per tag (10/hour),
  per user (20/hour) and per IP (30/15 min), counted before the code is checked. Only one claimant can win a tag.
- Tag IDs (80-bit) and public codes (50-bit) are random, never sequential. The admin area requires 2FA.

## Project layout

```
src/app/            pages and routes ((auth)/, dashboard/, admin/, t/[tagId], q/[publicCode], api/auth/)
src/server/         business logic: codes, batches, claiming, rate limits (take a db, so they're testable)
src/profile-types/  profile type registry (milestone 3 adds each type's schema, editor and public page)
src/lib/            env validation, auth, database, email, CSP
src/lib/db/schema/  auth.ts (generated) + app.ts (tags, profiles, scans, messages, audit log)
src/proxy.ts        per-request CSP nonce + login redirect
db/migrations/      SQL migrations (generated by drizzle-kit)
tests/              unit/, integration/, e2e/
docker-compose.yml  local services
```
