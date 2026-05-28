# Deployment

IroHarness is designed to run as a local-first companion on an always-on
machine, then expose only the routes needed for trusted users, devices, and
streaming tools.

Use these examples as starting points:

```text
examples/deployment/
  launchd.plist
  systemd.service
  Caddyfile
  nginx.conf
  tailscale-serve.sh
```

## Production Checklist

Before exposing a generated app through Tailscale, a reverse proxy, Discord,
YouTube, OBS, or device adapters:

```bash
npm run doctor:production
npx iroharness doctor . --production --json
```

Required defaults:

- set `IROHARNESS_ADMIN_TOKEN` to a strong secret
- keep `.env`, `.iroharness/`, and audience backups out of git
- use PostgreSQL/Supabase for long-running public audience state
- keep `SOUL.md`, `IDENTITY.md`, `MEMORY.md`, and `VOICE.md` private unless the
  character is intended to be public
- expose `/` and `/events` only to the audience that should talk to or render
  the character
- protect `/?view=admin` and `/audience/*` with the admin token or with an
  upstream access policy

## Mac mini With launchd

Copy `examples/deployment/launchd.plist` to:

```text
~/Library/LaunchAgents/dev.iroharness.companion.plist
```

Edit:

- `WorkingDirectory`
- `EnvironmentVariables`
- log paths

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/dev.iroharness.companion.plist
launchctl start dev.iroharness.companion
```

This is the preferred shape for a Mac mini that stays online and serves Slack,
Discord, YouTube, OBS Browser Source, M5Stack, Even G2, and browser clients.

## Linux With systemd

Copy `examples/deployment/systemd.service` to:

```text
/etc/systemd/system/iroharness.service
```

Edit:

- `User`
- `WorkingDirectory`
- `EnvironmentFile`

Then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now iroharness
sudo systemctl status iroharness
```

## Tailscale-Only Exposure

For a private companion, keep the Node server bound to `127.0.0.1` and expose it
only over the tailnet:

```bash
IROHARNESS_PORT=4178 npm start
examples/deployment/tailscale-serve.sh
```

Use Tailscale ACLs or device posture checks for who can reach the companion.
This is a good default for developer-only deep discussion and private devices.

## Reverse Proxy

Use `examples/deployment/Caddyfile` or `examples/deployment/nginx.conf` when the
companion must be reachable from the public internet.

Recommended boundary:

- proxy public chat, overlay, and event routes to the app
- restrict admin and audience management routes with an upstream auth layer
- keep the Node app on `127.0.0.1`
- terminate HTTPS at the proxy
- forward `X-Forwarded-*` headers for logs and policy decisions

## Data Persistence

Local demos use:

```text
.iroharness/pjos.json
.iroharness/users.json
```

Production deployments should use:

```text
protocols/sql/postgres-audience.sql
```

That schema includes `iroharness_audit_log` so user, identity, permission, and
stream changes remain reviewable without making chat logs the source of truth.
