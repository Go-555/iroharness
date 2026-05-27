# Privacy And Security

IroHarness handles character memory, audience identity, permissions, and stream
operations. Treat those as production data even when the app is running locally.

## Data Classes

| Data | Examples | Default Storage | Guidance |
|---|---|---|---|
| Character profile | `SOUL.md`, `IDENTITY.md`, `VOICE.md` | project files | Public only if the character is meant to be public. |
| Character memory | `MEMORY.md`, PJOS artifacts | project files / `.iroharness` | Redact private facts before sharing. |
| Audience identity | YouTube channel IDs, Discord IDs, Slack IDs, browser/device IDs | `.iroharness/users.json` or PostgreSQL | Treat as user data. Do not paste into public issues without consent. |
| Permissions | `delegate_work`, `manage_stream`, `manage_users` | `.iroharness/users.json` or PostgreSQL | Review before streams and before enabling tunnels. |
| Credentials | Discord tokens, YouTube API keys, OBS password, admin token | `.env` / environment | Never commit or paste into logs. |

## Generated App Defaults

`iroharness init` creates:

```text
.gitignore
.env.example
.iroharness/
```

The generated `.gitignore` excludes:

```text
.env
.iroharness/*.json
```

Run the production doctor before exposing the app:

```bash
IROHARNESS_ADMIN_TOKEN="$(openssl rand -hex 24)" npm run doctor:production
npx iroharness doctor . --production --json
```

The production doctor verifies:

- `IROHARNESS_ADMIN_TOKEN` is set
- the token is at least 16 characters
- audience admin routes are wired to the token
- `.env` is ignored
- `.iroharness/*.json` is ignored

## Admin Routes

Audience management routes can create users, link platform identities, grant
permissions, and register stream sessions. Set `IROHARNESS_ADMIN_TOKEN` whenever
the dev server is reachable beyond a trusted local machine.

Accepted headers:

```text
authorization: Bearer <token>
x-iroharness-admin-token: <token>
```

Do not put the admin token in a public OBS URL, stream overlay URL, screenshot,
or issue reproduction.

## Stream Operations

OBS scene, overlay, mute, and stream control requests require `manage_stream`.
Use scoped permission overrides for temporary operators:

```bash
npx iroharness audience grant . \
  --user trusted-fan \
  --permission manage_stream \
  --scope streamSession:youtube-live \
  --reason "guest moderator" \
  --expires-at 2099-01-01T00:00:00Z
```

Use `--expires-at` for temporary privileges. After the stream, review and remove
or expire temporary privileges in the backing registry. Production deployments
should use PostgreSQL/Supabase and cleanup workflows.

## Issue And PR Hygiene

Before posting logs, screenshots, fixtures, or reproduction data:

- remove credentials and tokens
- replace real YouTube, Discord, Slack, and device IDs
- remove private character memory and personal facts
- remove private PJOS tickets, artifacts, customer names, or work details
- keep only the minimal payload needed to reproduce the problem

Use fake IDs such as:

```text
youtube:UCEXAMPLE
discord:1234567890
slack:U123EXAMPLE
```

## Production Storage

For long-running public deployments, prefer the PostgreSQL/Supabase schema in:

```text
protocols/sql/postgres-audience.sql
```

Back up the database, restrict admin access, and keep service credentials in the
deployment secret manager rather than project files.
