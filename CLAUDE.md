# NFC Tag Platform (nfccardusecase)

Generic NFC/QR tag platform. We ship pre-encoded tags (cards, pet collar tags,
stickers, keychains). A customer activates a tag with the claim code from the
packaging, creates an account, and links the tag to ONE profile of a type:
`business_card`, `lost_pet`, `lost_device`, `lost_id`.
Tapping or scanning opens `/t/{tagId}`, which renders the public page for that type.

Full MVP spec: `docs/spec.md` — read it before starting a new milestone.
Brand/domain is not final: use `APP_BASE_URL` from env, never hardcode a domain.

## Stack (open source, self-hosted on a cloud VM)

- Next.js (App Router) + TypeScript (strict)
- PostgreSQL + Drizzle ORM (migrations in `db/migrations`)
- Better Auth (email/password, passkeys, 2FA)
- S3-compatible object storage for photos/logos
- OpenBao for NTAG 424 master keys and app secrets
- Docker Compose (local + prod), Caddy for HTTPS
- Email via SMTP (provider-agnostic, configured by env)
- Encoder: Python CLI in `encoder/` (pyscard + ACR1252U, NTAG 424 DNA)
- Tests: Vitest (unit/integration), Playwright (end-to-end)

## Commands

- Start services: `docker compose up -d` (Postgres, Mailpit inbox at http://localhost:8025, S3, OpenBao)
- Dev server: `npm run dev`
- Tests: `npm test` (unit + DB integration, needs `TEST_DATABASE_URL`) and `npm run test:e2e`
  (builds and serves production on :3100) — both must pass before every commit
- Lint/types/format: `npm run lint && npm run typecheck && npm run format:check`
- DB: `npm run db:generate -- --name <change>` then `npm run db:migrate`
- Auth tables: `npm run auth:schema` (never hand-edit `src/lib/db/schema/auth.ts`)
- Make an admin: `npm run admin:grant -- email@example.com`

## Architecture rules

- Profile types live in `src/profile-types/{type}/` with:
  `schema.ts` (Zod), `Editor.tsx`, `PublicPage.tsx`, optional `actions.ts`.
  Register types only in `src/profile-types/registry.ts`.
- `profiles.data` is JSON; always validate with the type's Zod schema on write and read.
- One profile per tag: unique constraint on `profiles.tag_id`.
- Tag states: `unclaimed` → `active` → `disabled`. `/t/{id}` routes by state.
- Two link kinds:
  - NFC tap: `/t/{tagId}?…` with NTAG 424 SUN params (verified).
  - QR/short code: `/q/{publicCode}` — read-only public page, never claims or edits.
- Server-side logic in `src/server/`; route handlers stay thin.
- Next.js 16: middleware is `src/proxy.ts`; read `node_modules/next/dist/docs/` before using new APIs (see AGENTS.md).
- Use `getDb()` / `getAuth()` (created on first request). Never read env at module top level: builds run without secrets.
- Protected pages call `requireUser()` / `requireAdmin()`; the proxy redirect is only a convenience.

## Security rules (never break these)

- Validate ALL input server-side with Zod. Never trust the client.
- NTAG 424: verify CMAC with the tag's derived key; reject if counter <= `tags.last_counter`;
  update the counter atomically.
- Claim codes: store Argon2 hash only; never log or return them; rate-limit claim attempts.
- `lost_*` public pages never show owner email, phone, name, or address.
  Finder contact goes through the relay only.
- `lost_id` must never store ID numbers, card numbers, or addresses.
- Location sharing requires explicit browser permission from the finder; never silent.
- Rate-limit login, claim, and finder-contact endpoints; ALTCHA on finder forms.
- Sanitize any user HTML/markdown (DOMPurify). CSP is nonce-based: no inline `style=` attributes or inline scripts.
- Never log secrets, tokens, claim codes, or personal data. Secrets come from env/OpenBao.
- Random, non-sequential IDs everywhere public (tag IDs, public codes).
- Follow OWASP Top 10. Ask before weakening any of these rules.

## Conventions

- Write tests with every feature; cover security rules with explicit tests.
- Small, focused commits with a clear "why".
- Ask before adding a new dependency; prefer well-maintained open-source packages.
- Mobile-first public pages; test vCard download on iOS Safari and Android Chrome.
- Keep this file short: add one line when a mistake repeats.
