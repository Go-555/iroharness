#!/usr/bin/env sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

BACKUP_DIR="${IROHARNESS_BACKUP_DIR:-./agent-output/postgres-audience-backups}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
BACKUP_FILE="${1:-${BACKUP_DIR}/iroharness-audience-${TIMESTAMP}.dump}"

mkdir -p "$(dirname "$BACKUP_FILE")"

pg_dump "$DATABASE_URL" \
  --format=custom \
  --data-only \
  --no-owner \
  --no-privileges \
  --table=public.iroharness_users \
  --table=public.iroharness_user_identities \
  --table=public.iroharness_permission_overrides \
  --table=public.iroharness_stream_sessions \
  --table=public.iroharness_audit_log \
  --file="$BACKUP_FILE"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"
fi

echo "IroHarness audience backup written: $BACKUP_FILE"
