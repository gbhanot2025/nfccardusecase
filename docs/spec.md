# MVP Spec — Generic NFC Tag Platform

## Goal

One platform where a customer activates any shipped tag (card, collar tag, sticker)
and chooses what it's for: Digital Card, Lost Pet, Lost Device, or Lost ID/Wallet.
Whoever taps or scans the tag sees the right page. For lost items, the owner can be
contacted without exposing their personal details.

## Business model

- We encode and ship tags. Each tag ships with a claim code (packaging/insert).
- Customer taps tag → activation screen → enters claim code → signs up/logs in → tag linked.
- One profile per tag. Lost tag can be disabled; replacement tag can be linked.

## Shared features (all types)

| Feature      | Details                                                                     |
| ------------ | --------------------------------------------------------------------------- |
| Account      | Email/password, passkeys, 2FA, password reset                               |
| Activation   | Tap tag, enter claim code, link to account, choose profile type             |
| Dashboard    | List tags, edit profiles, disable tag, link replacement                     |
| Public page  | Mobile-first page at `/t/{tagId}`; QR/short code via `/q/{publicCode}`      |
| Tag security | NTAG 424 DNA signed tap links verified server-side; random IDs; claim codes |
| Admin        | Generate tag batches (IDs, claim codes, QR images, CSV); view/disable tags  |

## Profile types

| Type          | Owner enters                                                                     | Visitor sees                                     | Actions                                  |
| ------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| business_card | Name, title, company, phones, emails, website, photo, social links, company page | Full profile                                     | Save Contact (vCard 3.0, photo embedded) |
| lost_pet      | Pet name, photo, breed, medical notes, vet phone, reward (optional)              | Pet info; "I found this pet" banner in lost mode | Message owner, share location            |
| lost_device   | Device nickname, photo, return message, reward (optional)                        | "Please return this device"                      | Message owner, share location            |
| lost_id       | Return message, reward (optional)                                                | "You found a lost wallet/ID"                     | Message owner, share location            |

`lost_id` never stores ID/card numbers or addresses.

## Lost-item features (pet, device, id)

- Lost mode toggle: normal = minimal info; lost = urgent banner + reward.
- Contact relay: finder form → owner receives email; owner contact never shown.
- Share location: browser permission prompt, then GPS sent to owner.
- Scan alerts: owner emailed on every scan.
- Abuse protection: ALTCHA + rate limiting on finder forms.

## Data model

- users: id, email, auth fields
- tags: id, public_code, claim_code_hash, form_factor, allowed_types, status
  (unclaimed/active/disabled), owner_id, key_ref, last_counter, created_at
- profiles: id, tag_id (unique), type, data (JSON, schema per type), lost_mode, visibility
- scan_events: id, tag_id, created_at, source (nfc/qr), device_info, location (optional)
- messages: id, tag_id, body, finder_contact (optional), location (optional), created_at

## Out of scope for MVP

SMS/call relay, push notifications, mobile app, teams/company accounts, analytics
dashboard, wallet passes, online store/payments, medical ID type.

## Milestones

| Week | Milestone                                                                              |
| ---- | -------------------------------------------------------------------------------------- |
| 1    | Foundation: Docker Compose, Postgres, Drizzle schema, Better Auth, CI                  |
| 2    | Tags & claiming: admin batch generator, `/t/{id}` routing, claim flow                  |
| 2–4  | NFC encoder (Python CLI, NTAG 424 keys + SUN/SDM) and server CMAC/counter verification |
| 3    | Profile types: registry, 4 editors + public pages, vCard                               |
| 4    | Lost features: lost mode, relay, location share, scan alerts, ALTCHA, rate limits      |
| 5    | Hardening: OWASP review, CSP/headers, backups, monitoring                              |
| 6    | Deploy + pilot: production server, domain, runbook, 20–50 pilot users                  |

## Human tasks (outside the code)

- Register domain (not final yet) and check trademarks.
- Buy NTAG 424 DNA cards, on-metal tags, ACR1252U reader.
- Test on real iPhone and Android devices (NFC + QR).
- Independent security review before launch.
- Privacy policy and terms reviewed by a lawyer.
