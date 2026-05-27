# CLI

The `iroharness` CLI creates a minimal app that keeps the character identity in
the macro harness and uses replaceable brains, devices, and micro harnesses.

## Init

```bash
npx iroharness init ./my-companion --character Iroha
cd my-companion
npm install
cp .env.example .env
npm start
```

Generated files:

- `package.json`
- `src/app.mjs`
- `SOUL.md`
- `IDENTITY.md`
- `MEMORY.md`
- `VOICE.md`
- `.env.example`
- `.iroharness/`
- `.gitignore`
- `README.md`

Use `--force` only when you want to overwrite generated files.

`src/app.mjs` starts a local companion server. The generated app includes:

- browser chat at `/`
- OBS Browser Source mode at `/?view=overlay`
- audience admin at `/?view=admin`
- health/readiness and optional runtime/error metadata at `/health`
- OpenAPI at `/openapi.json`
- file-backed Project OS at `.iroharness/pjos.json`
- file-backed audience registry at `.iroharness/users.json`

`src/app.mjs` loads the character through `createFileCharacterProfile`, so the
generated markdown files are the local identity and memory source of truth.
`package.json` includes `npm run doctor` and `npm run doctor:production`, and
`.env.example` lists the common local, YouTube, Discord, and OBS settings.
The generated app reads `.env` on startup without adding a runtime dependency;
real environment variables still take precedence over `.env` values.
If `YOUTUBE_API_KEY` and `YOUTUBE_LIVE_CHAT_ID` are set, the generated app starts
the YouTube live chat polling runtime. If `DISCORD_BOT_TOKEN` is set, it starts
the Discord Gateway runtime. OBS WebSocket control is opt-in with
`IROHARNESS_ENABLE_OBS=1`; otherwise stream operations are recorded locally for
safe testing.
Set `IROHARNESS_ADMIN_TOKEN` before exposing the server beyond a trusted local
machine.

## Audience Setup

The generated app stores local audience data in `.iroharness/users.json`.
Use `iroharness audience` before a stream to link platform IDs and grant scoped
permissions without opening the admin UI.

Register a user and link YouTube/Discord IDs:

```bash
npx iroharness audience user ./my-companion \
  --id owner \
  --display-name "Owner" \
  --role owner \
  --youtube UCxxx \
  --discord 123456
```

Link another platform identity to the same user:

```bash
npx iroharness audience link ./my-companion \
  --user owner \
  --platform slack \
  --platform-user-id U123
```

Register a trusted fan or moderator, then grant a temporary stream operation
permission:

```bash
npx iroharness audience user ./my-companion \
  --id trusted-fan \
  --display-name "Trusted Fan" \
  --role fan \
  --discord 999999

npx iroharness audience grant ./my-companion \
  --user trusted-fan \
  --permission manage_stream \
  --scope stream:youtube \
  --reason "guest moderator" \
  --expires-at 2099-01-01T00:00:00Z
```

Register a live stream session for scoped permissions:

```bash
npx iroharness audience stream ./my-companion \
  --id youtube-live \
  --platform youtube \
  --channel "$YOUTUBE_LIVE_CHAT_ID" \
  --host owner
```

Inspect the file-backed registry:

```bash
npx iroharness audience list ./my-companion --json
```

## Doctor

Validate that a generated app still has the expected local shape:

```bash
npx iroharness doctor ./my-companion
npx iroharness doctor ./my-companion --json
```

The doctor command checks for `package.json`, `src/app.mjs`, `.iroharness/`,
`SOUL.md`, `IDENTITY.md`, `MEMORY.md`, `VOICE.md`, and `.env.example`.
Use `--json` for CI, deployment scripts, or stream preflight checks. It prints a
single JSON object to stdout and exits non-zero when `ok` is false.

Before exposing the companion server through Tailscale, a tunnel, a reverse
proxy, Discord, YouTube, or OBS tooling, run the production profile:

```bash
IROHARNESS_ADMIN_TOKEN="$(openssl rand -hex 24)" \
  npx iroharness doctor ./my-companion --production
```

`--production` reads `.env` plus real environment variables and fails unless
`IROHARNESS_ADMIN_TOKEN` is present, at least 16 characters long, and the
generated app wires that token into the audience admin routes. This protects
user, identity, permission, and stream-session management while leaving public
chat and overlay routes usable.
