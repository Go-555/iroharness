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

For always-on deployments, use the templates in `examples/deployment/` and the
guide in `docs/deployment.md`. They cover Mac mini `launchd`, Linux `systemd`,
Tailscale-only exposure, and Caddy/nginx reverse proxies.

## Connect

`iroharness connect` prepares a generated app for a concrete interface or body.
This is the non-interactive first step toward onboarding presets.

### Slack

Slack is a text interface. It does not need a full visual body by default, but
it can use a lightweight presence body later for `idle`, `thinking`, `working`,
`done`, and `error` status.

```bash
npx iroharness connect slack ./my-companion \
  --bot-token xoxb-... \
  --signing-secret ... \
  --bot-user-id UIROHA \
  --owner-slack-user-id UOWNER
```

This updates `.env`, writes `.iroharness/connections/slack.json`, and links the
owner Slack user in `.iroharness/users.json` when an owner Slack ID is supplied.
It also writes `.iroharness/connections/slack-onboarding.md`, a copy-paste
checklist for Slack Bot Token Scopes, Event Subscriptions, Request URL, and the
local `.env` values.

Current prototype runtime:

```bash
cd ~/.iroharness/source
set -a
source ~/.iroharness/apps/iroha/.env
set +a
npm run example:slack-stackchan
```

Expose `/slack/events` from the running host with Tailscale Serve, Cloudflare
Tunnel, ngrok, or another trusted HTTPS ingress.

### StackChan

StackChan is a physical body preset. Its body, mic, speaker, display, and
button/touch inputs are mostly determined by the device, so onboarding asks for
the host URL and firmware-facing Wi-Fi details instead of asking for a separate
body type.

```bash
npx iroharness connect stackchan ./my-companion \
  --host-url http://100.64.0.10:4182 \
  --wifi-ssid YOUR_WIFI_SSID \
  --wifi-pass YOUR_WIFI_PASSWORD
```

This writes:

- `.iroharness/connections/stackchan.device.json`
- `.iroharness/connections/stackchan-firmware-config.json`

It also writes `STACKCHAN_DEVICE_TOKEN` to `.env`. The token is required for
`POST /device/stackchan/invoke` and the StackChan realtime WebSocket. CLI JSON
output redacts Wi-Fi passwords and device tokens.

Use `.iroharness/connections/stackchan-firmware-config.json` and the generated
provisioning runbook as the source for the firmware `/config.json`. The intended
runtime shape follows AIAvatarStackChan: firmware owns Wi-Fi, display, mic,
speaker, touch, camera, servo, and local buffering; IroHarness owns character
identity, audience, Project OS, provider routing, STT, LLM, and TTS credentials.
The M5Stack must use a LAN or Tailscale address it can reach; `127.0.0.1` only
points back to the M5Stack itself. `connect stackchan` records a firmware
reachability check, and `iroharness doctor` fails when the saved StackChan host
URL is `localhost`, `127.*`, `0.0.0.0`, `::1`, or another local-only URL.

## View Export

`iroharness view export` creates a zone-limited runtime view. This is the first
implementation step toward Public Gateway / Trusted Gateway separation.

```bash
npx iroharness view export ./my-companion \
  --zone trusted \
  --out /Users/iroharness-trusted/iroha-view \
  --force
```

The output shape is:

```text
/Users/iroharness-trusted/iroha-view/
├── current/
│   ├── SOUL.md
│   ├── IDENTITY.md
│   ├── VOICE.md
│   ├── MEMORY.md
│   ├── MEMORY.public.md
│   ├── MEMORY.trusted.md
│   ├── PROJECT_OS.md
│   ├── project-os.json
│   ├── gateway-policy.json
│   ├── work-runner-policy.json
│   ├── connections/
│   └── view-manifest.json
└── state/
    ├── logs/
    └── proposals/
```

Rules:

- `current/` is generated from the source app and should be treated as read-only.
- `state/` is where the gateway can write logs and proposals.
- `.env` is never copied into a view.
- Public and trusted `view-manifest.json` files redact the source app path.
- Root `MEMORY.md` from the source app is treated as owner/core memory. Public
  and trusted views only receive `memory/public.md` and `memory/trusted.md`
  layers when they exist. The exported `MEMORY.md` is rebuilt from the allowed
  layers for that zone.
- Project OS is exported as `project-os.json` and `PROJECT_OS.md`. A ticket,
  run, or artifact must set `metadata.visibility` to `public` or `trusted` to
  appear outside owner views. Unmarked items are owner-only by default.
- `gateway-policy.json` states what the gateway may read and write. Gateways
  cannot directly read Core SSOT, `.env`, host files, repository credentials,
  browser sessions, or the host Codex OAuth session.
- `work-runner-policy.json` states that Codex OAuth, repository work, browser
  control, and similar privileged operations are runner-only boundaries. Public
  views cannot delegate work; trusted views require permission; owner views may
  delegate through scoped workspaces.
- Public views do not receive Slack or StackChan trusted connection files.
- Trusted views receive sanitized connection metadata; Wi-Fi passwords and
  device tokens are redacted in exported connection JSON.

The gateway should be started from a view directory, not from the full source
app, when running as a public or trusted service account.

The Slack + StackChan example can use an exported trusted view directly:

```bash
IROHARNESS_VIEW_DIR=/Users/iroharness-trusted/iroha-view \
npm run example:slack-stackchan
```

Before attaching a privileged worker, validate that the exported view contains a
runner-only policy:

```bash
npx iroharness work-runner check /Users/iroharness-trusted/iroha-view
npx iroharness work-runner check /Users/iroharness-trusted/iroha-view --json
```

The check reads `current/work-runner-policy.json`, confirms that the manifest
points to it, and verifies that gateway direct access to Codex OAuth, repository
credentials, browser sessions, and host files is denied.

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

npx iroharness audience revoke ./my-companion \
  --user trusted-fan \
  --permission manage_stream \
  --scope stream:youtube
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

Back up and restore the file-backed registry:

```bash
npx iroharness audience export ./my-companion \
  --file ./audience-backup.json

npx iroharness audience import ./my-companion \
  --file ./audience-backup.json \
  --force
```

`audience import` overwrites `.iroharness/users.json`, so it requires
`--force` when state already exists. Exported backups include users, platform
identities, permission overrides, stream sessions, and audit log records. Treat
them as private operational data. Import adds an `audience.backup.import` audit
record to the restored file.

## Doctor

Validate that a generated app still has the expected local shape:

```bash
npx iroharness doctor ./my-companion
npx iroharness doctor ./my-companion --json
```

The doctor command checks for `package.json`, `src/app.mjs`, `.iroharness/`,
`SOUL.md`, `IDENTITY.md`, `MEMORY.md`, `VOICE.md`, and `.env.example`.
If StackChan has been connected, it also validates that the saved firmware host
URL is not a loopback/local-only address and that the face/invoke paths match
the expected device contract.
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
