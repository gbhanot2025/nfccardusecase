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
owners can turn tags off and on; admins can disable tags and reissue lost claim codes. NTAG 424 tap verification and
the profile editors/public pages come next.

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
4. To try claiming without a physical tag, open a tag's NFC link (`/t/{tag_id}` from the CSV) and enter its claim code.

| Link              | Who uses it                                  | What it does                                  |
| ----------------- | -------------------------------------------- | --------------------------------------------- |
| `/t/{tagId}`      | NFC tap (written to the chip by the encoder) | Activation if unclaimed, else the public page |
| `/q/{publicCode}` | Printed QR code                              | Public page only: never claims or edits       |
| `/admin`          | Admins (with 2FA)                            | Batches, tag search, disable/enable           |

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
