# PostgreSQL Audience Backup And Restore

Long-running IroHarness deployments should keep audience identity, permissions,
stream sessions, and audit logs in PostgreSQL or Supabase.

The canonical schema is:

```text
protocols/sql/postgres-audience.sql
```

The backup/restore scripts operate only on IroHarness audience tables:

```text
iroharness_users
iroharness_user_identities
iroharness_permission_overrides
iroharness_stream_sessions
iroharness_audit_log
```

## Backup

Use `pg_dump` custom format so the backup can be restored with `pg_restore`:

```bash
export DATABASE_URL="postgres://..."
examples/postgres-audience-backup.sh
```

To choose the output path:

```bash
examples/postgres-audience-backup.sh ./agent-output/iroharness-audience.dump
```

The script writes a `.sha256` file when `sha256sum` or `shasum` is available.
Treat both files as private data. They contain platform user IDs, roles,
permission overrides, stream sessions, and audit records.

## Restore

Restore is intentionally explicit because it replaces existing audience state.
The target database must already have the IroHarness schema.

```bash
export DATABASE_URL="postgres://..."
export IROHARNESS_RESTORE_CONFIRM=restore-audience
examples/postgres-audience-restore.sh ./agent-output/iroharness-audience.dump
```

To apply the schema immediately before restoring:

```bash
export IROHARNESS_APPLY_SCHEMA=1
examples/postgres-audience-restore.sh ./agent-output/iroharness-audience.dump
```

The restore script:

1. refuses to run without `IROHARNESS_RESTORE_CONFIRM=restore-audience`
2. optionally applies `protocols/sql/postgres-audience.sql`
3. truncates IroHarness audience tables in one transaction
4. restores the archive with `pg_restore --data-only --exit-on-error`

## Supabase Notes

For Supabase, use a connection string with permission to read and write the
IroHarness tables. Keep the service role key and database URL in your deployment
secret manager, not in `.env` files committed to git.

Before restoring into production:

- create a fresh backup from the current production database
- verify the backup checksum
- restore first into a staging database
- run the generated app's `doctor --production` check
- confirm `/health` still reports audience admin protection

## Recovery Policy

Audience state controls whether a person is a public fan, trusted collaborator,
developer, stream operator, or owner. Do not rely on chat logs to reconstruct
that state. Keep scheduled backups and retain at least one known-good backup
from before major stream, Discord, or admin UI changes.

