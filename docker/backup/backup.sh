#!/bin/sh
# Nightly Postgres backup: custom-format dump into /backups, keeping BACKUP_KEEP_DAYS (default 14).
# Copy /backups off the server too (see docs/runbook.md); a backup on the same disk isn't a backup.
set -eu
KEEP="${BACKUP_KEEP_DAYS:-14}"
while true; do
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  FILE="/backups/tagplatform-${STAMP}.dump"
  if pg_dump --format=custom --file="${FILE}.partial" "${DATABASE_URL}"; then
    mv "${FILE}.partial" "${FILE}"
    echo "backup ok: $(basename "${FILE}") ($(du -h "${FILE}" | cut -f1))"
  else
    rm -f "${FILE}.partial"
    echo "backup FAILED at ${STAMP}" >&2
  fi
  find /backups -name 'tagplatform-*.dump' -mtime "+${KEEP}" -delete
  sleep 86400
done
