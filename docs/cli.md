# CLI

The `iroharness` CLI creates a minimal app that keeps the character identity in
the macro harness and uses replaceable brains, devices, and micro harnesses.

## Init

```bash
npx iroharness init ./my-companion --character Iroha
cd my-companion
npm install
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
- OpenAPI at `/openapi.json`
- file-backed Project OS at `.iroharness/pjos.json`
- file-backed audience registry at `.iroharness/users.json`

`src/app.mjs` loads the character through `createFileCharacterProfile`, so the
generated markdown files are the local identity and memory source of truth.
`package.json` includes `npm run doctor` and `npm run doctor:production`, and
`.env.example` lists the common local, YouTube, Discord, and OBS settings.
Set `IROHARNESS_ADMIN_TOKEN` before exposing the server beyond a trusted local
machine.

## Doctor

Validate that a generated app still has the expected local shape:

```bash
npx iroharness doctor ./my-companion
```

The doctor command checks for `package.json`, `src/app.mjs`, `.iroharness/`,
`SOUL.md`, `IDENTITY.md`, `MEMORY.md`, `VOICE.md`, and `.env.example`.

Before exposing the companion server through Tailscale, a tunnel, a reverse
proxy, Discord, YouTube, or OBS tooling, run the production profile:

```bash
IROHARNESS_ADMIN_TOKEN="$(openssl rand -hex 24)" \
  npx iroharness doctor ./my-companion --production
```

`--production` fails unless `IROHARNESS_ADMIN_TOKEN` is present, at least 16
characters long, and the generated app wires that token into the audience admin
routes. This protects user, identity, permission, and stream-session management
while leaving public chat and overlay routes usable.
