# Install

IroHarness should be installable in the same broad style as OpenClaw: one
command for normal users, plus explicit source and npm paths for developers.

OpenClaw's installer model is useful because it exposes multiple routes:
installer script, npm global install, and source checkout. IroHarness follows
that shape while keeping each person's character app separate from the OSS
source checkout.

## Recommended For Now: Git Installer

Until the npm package is published, use the GitHub install path:

```bash
curl -fsSL https://raw.githubusercontent.com/Go-555/iroharness/main/install.sh | bash
```

This does four things:

1. clones or updates the source checkout at `~/.iroharness/source`
2. installs dependencies and links the `iroharness` CLI
3. creates a companion app at `~/iroharness-apps/iroha`
4. runs `npm run doctor`

Custom character and app directory:

```bash
curl -fsSL https://raw.githubusercontent.com/Go-555/iroharness/main/install.sh | bash -s -- \
  --character Iroha \
  --app-dir ~/iroharness-apps/iroha
```

Dry run:

```bash
curl -fsSL https://raw.githubusercontent.com/Go-555/iroharness/main/install.sh | bash -s -- --dry-run
```

## Future npm Path

After npm publication, the intended route is:

```bash
npm install -g iroharness@latest
iroharness init ~/iroharness-apps/iroha --character Iroha
cd ~/iroharness-apps/iroha
npm install
npm run doctor
npm start
```

The installer already supports this shape:

```bash
curl -fsSL https://raw.githubusercontent.com/Go-555/iroharness/main/install.sh | bash -s -- --npm
```

## Directory Layout

Keep source, personal apps, and runtime state separate:

```text
~/.iroharness/
└── source/                 # OSS checkout installed by install.sh

~/iroharness-apps/
└── iroha/                  # one person's companion app
    ├── AGENTS.md
    ├── SOUL.md
    ├── IDENTITY.md
    ├── MEMORY.md
    ├── VOICE.md
    ├── .env
    ├── src/
    │   └── app.mjs
    └── .iroharness/
        ├── pjos.json
        └── users.json
```

Rules:

- `~/.iroharness/source` is disposable OSS source.
- `~/iroharness-apps/iroha` is the user's actual character instance.
- `.env` and `.iroharness/` are local/private and should not be committed.
- `SOUL.md`, `IDENTITY.md`, `MEMORY.md`, and `VOICE.md` are the character profile.

## StackChan First Connection

Use the Slack + StackChan host as the first physical-device route:

```bash
cd ~/.iroharness/source
npm run example:slack-stackchan
```

The host prints:

```text
StackChan face JSON: http://127.0.0.1:4182/stackchan/face
StackChan invoke URL: http://127.0.0.1:4182/device/stackchan/invoke
StackChan SSE: http://127.0.0.1:4182/body/stackchan/events
```

On the StackChan firmware side, edit:

```text
~/.iroharness/source/examples/stackchan-face-poller/data/config.json
```

Use a LAN or Tailscale address that the M5Stack can reach. Do not use
`127.0.0.1` from the device:

```json
{
  "wifi_ssid": "YOUR_WIFI_SSID",
  "wifi_pass": "YOUR_WIFI_PASSWORD",
  "face_url": "http://MAC_MINI_IP:4182/stackchan/face",
  "invoke_url": "http://MAC_MINI_IP:4182/device/stackchan/invoke",
  "device_token": "YOUR_STACKCHAN_DEVICE_TOKEN",
  "device_id": "stackchan",
  "poll_interval_ms": 500,
  "wifi_retry_base_ms": 1000,
  "wifi_retry_max_ms": 30000,
  "http_retry_base_ms": 1000,
  "http_retry_max_ms": 15000
}
```

Then build/upload from:

```bash
cd ~/.iroharness/source/examples/stackchan-face-poller
pio run
pio run --target upload
pio run --target uploadfs
```

Connection responsibilities:

| Side | Responsibility |
|---|---|
| IroHarness host | identity, memory, PJOS, Slack, model routing, permissions |
| StackChan firmware | Wi-Fi, display, buttons/touch, polling, local reconnect |
| `/stackchan/face` | current face/mode/text |
| `/device/stackchan/invoke` | touch/button/vision/audio events from the device |
| `/body/stackchan/events` | future richer state streaming |

The first version intentionally uses HTTP polling and invoke POSTs. Full
AIAvatarStackChan-compatible WebSocket, STT, TTS, servo, and camera support
should be added after this base loop works on real hardware.
