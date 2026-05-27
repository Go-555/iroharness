#!/usr/bin/env sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  echo "usage: examples/postgres-audience-restore.sh <backup.dump>" >&2
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

if [ "${IROHARNESS_RESTORE_CONFIRM:-}" != "restore-audience" ]; then
  echo "refusing to restore without IROHARNESS_RESTORE_CONFIRM=restore-audience" >&2
  exit 1
fi

if [ "${IROHARNESS_APPLY_SCHEMA:-0}" = "1" ]; then
  psql "$DATABASE_URL" \
    --set=ON_ERROR_STOP=1 \
    --file="${IROHARNESS_SCHEMA_FILE:-protocols/sql/postgres-audience.sql}"
fi

psql "$DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
begin;
truncate table
  public.iroharness_user_identities,
  public.iroharness_permission_overrides,
  public.iroharness_stream_sessions,
  public.iroharness_audit_log,
  public.iroharness_users
cascade;
commit;
SQL

pg_restore \
  --dbname="$DATABASE_URL" \
  --data-only \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$BACKUP_FILE"

echo "IroHarness audience backup restored: $BACKUP_FILE"
