# Production runbook

Everything runs on one Linux VM with Docker: Caddy (HTTPS) → app (Next.js) → Postgres, OpenBao (NTAG 424 master key),
SeaweedFS (photos), plus a nightly backup container. Only ports 80 and 443 are open to the internet.

## 1. First-time setup

1. **VM:** Ubuntu 24.04 LTS, 2 vCPU / 4 GB RAM is plenty for the pilot. Install Docker Engine + the compose plugin.
   Firewall: allow 22 (your IP only), 80, 443. Turn on unattended security upgrades.
2. **DNS:** point `APP_DOMAIN` (A/AAAA records) at the VM. Caddy gets the certificate automatically on first start.
3. **Code and config:**
   ```bash
   git clone https://github.com/gbhanot2025/nfccardusecase.git /opt/tagplatform && cd /opt/tagplatform
   cp .env.production.example .env.production && chmod 600 .env.production
   # fill in every value; generate secrets with: openssl rand -base64 48
   ```
   For object storage, copy `docker/seaweedfs/s3.json` to `/opt/tagplatform-secrets/s3.json`, replace the dev keys
   with long random ones (same as `S3_ACCESS_KEY`/`S3_SECRET_KEY`) and set `S3_CONFIG_FILE` to that path.
4. **Start the database and run migrations:**
   ```bash
   alias dc='docker compose -f docker-compose.prod.yml --env-file .env.production'
   dc up -d postgres openbao seaweedfs
   dc run --rm migrator
   ```
5. **Initialise OpenBao (once):**
   ```bash
   dc exec openbao bao operator init -key-shares=3 -key-threshold=2
   ```
   Store the 3 unseal keys and the root token **offline, in separate places** (e.g. password manager + printed copy in
   a safe). Losing them all means losing the master key, and every encoded tag stops verifying.
   ```bash
   dc exec openbao bao operator unseal   # run twice, with two different unseal keys
   dc exec -e BAO_TOKEN=<root token> openbao sh -c '
     bao secrets enable -path=secret kv-v2 &&
     bao kv put secret/ntag424/master-key key=$(head -c16 /dev/urandom | od -An -tx1 | tr -d " \n") &&
     echo "path \"secret/data/ntag424/master-key\" { capabilities = [\"read\"] }" | bao policy write ntag424-read - &&
     bao token create -policy=ntag424-read -period=768h -field=token'
   ```
   Put the printed token in `.env.production` as `OPENBAO_TOKEN` (the app can only read the master key). The encoder
   operator needs a token with the same read policy on their own machine. Revoke the root token when done:
   `dc exec -e BAO_TOKEN=<root token> openbao bao token revoke -self`.
6. **Start everything:** `dc up -d --build`, then open `https://APP_DOMAIN/api/health` → `{"ok":true}`.
7. **First admin:** sign up in the browser, verify the email, then
   `dc run --rm migrator npx tsx scripts/grant-admin.ts you@example.com` and turn on two-step verification.

## 2. Deploying a new version

```bash
cd /opt/tagplatform && git pull
dc build app migrator
dc run --rm migrator          # migrations first (they're additive; the old app keeps working meanwhile)
dc up -d app                  # restarts the app; Caddy keeps serving
dc ps && curl -fsS https://$APP_DOMAIN/api/health
```

Roll back: `git checkout <previous tag>` and repeat (migrations are not rolled back automatically; they're designed to
be backwards-compatible).

## 3. After a server restart

OpenBao starts **sealed**. Until it's unsealed, taps still open pages but aren't verified (no "Genuine tag", no scan
alerts for NFC). Unseal with two keys: `dc exec openbao bao operator unseal` (twice).

## 4. Backups and restore

- The `backup` container writes `tagplatform-<time>.dump` to `BACKUP_DIR` every 24 hours and keeps 14 days.
- **Copy backups off the server** daily (e.g. `rclone copy /opt/tagplatform/backups remote:tagplatform-backups` in a
  cron job). Also back up the OpenBao volume (`openbao_data`) and `s3data` weekly; the OpenBao data is useless
  without the unseal keys, which is fine.
- **Restore test (do it monthly):**
  ```bash
  dc exec -T postgres createdb -U tagplatform restore_test
  dc exec -T postgres pg_restore -U tagplatform -d restore_test < backups/tagplatform-<time>.dump
  dc exec -T postgres psql -U tagplatform -d restore_test -c 'select count(*) from tags'
  dc exec -T postgres dropdb -U tagplatform restore_test
  ```
- **Real restore:** stop the app (`dc stop app`), `dropdb`/`createdb tagplatform`, `pg_restore` the dump, `dc up -d app`.

## 5. Monitoring

- **Uptime:** point an external monitor at `https://APP_DOMAIN/api/health` every minute; alert on 2 failures.
  It returns 503 if the database is unreachable.
- **Containers:** `dc ps` shows health; `restart: unless-stopped` restarts crashed services. Logs rotate at 5×10 MB:
  `dc logs -f app`, `dc logs caddy`.
- **Things to watch in the app logs:** "Unverified tap" warnings (many in a row for one tag may mean a cloned tag),
  "master key unavailable" (OpenBao sealed or token expired), "email could not be sent" (SMTP problem).
- **Disk:** keep an eye on `df -h` (backups and photos grow).
- **Housekeeping** runs hourly when `/api/health` is called: expired rate-limit counters are removed, and finder
  messages and scan history older than 180 days are deleted (`RETENTION_DAYS` in `src/server/maintenance.ts`).
  Without an uptime monitor calling the health check, it doesn't run, so set one up.

## 6. Incidents

| Situation                   | What to do                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| A tag is abused or cloned   | Admin → search the tag → **Disable** (the owner can't re-enable it).                            |
| Printed claim codes leaked  | Batch page → **Reissue claim codes** (only unclaimed tags; old codes stop working).             |
| `BETTER_AUTH_SECRET` leaked | Replace it in `.env.production`, `dc up -d app`: all sessions end and finder-form checks reset. |
| `OPENBAO_TOKEN` leaked      | Create a new read-only token (step 5), update `.env.production`, revoke the old one.            |
| Master key suspected leaked | Write a new version (`bao kv put …`), encode new tags with it; old tags keep their `key_ref`.   |
| Database password leaked    | `ALTER USER tagplatform PASSWORD …`, update `.env.production`, restart app and backup.          |

## 7. Encoding tags

See `encoder/README.md`. After each encoding session, upload the encoder's results CSV on the batch page
(**Import results**) so taps can be verified.
