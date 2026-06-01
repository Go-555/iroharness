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
3. creates a companion app at `~/.iroharness/apps/iroha`
4. runs `npm run doctor`

Custom character and app directory:

```bash
curl -fsSL https://raw.githubusercontent.com/Go-555/iroharness/main/install.sh | bash -s -- \
  --character Iroha \
  --app-dir ~/.iroharness/apps/iroha
```

Dry run:

```bash
curl -fsSL https://raw.githubusercontent.com/Go-555/iroharness/main/install.sh | bash -s -- --dry-run
```

## Future npm Path

After npm publication, the intended route is:

```bash
npm install -g iroharness@latest
iroharness init ~/.iroharness/apps/iroha --character Iroha
cd ~/.iroharness/apps/iroha
npm install
npm run doctor
npm start
```

The installer already supports this shape:

```bash
curl -fsSL https://raw.githubusercontent.com/Go-555/iroharness/main/install.sh | bash -s -- --npm
```

## Directory Layout

Keep source, personal apps, and runtime state under one IroHarness home:

```text
~/.iroharness/
├── source/                 # OSS checkout installed by install.sh
└── apps/
    └── iroha/              # one person's companion app
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
- `~/.iroharness/apps/iroha` is the user's actual character instance.
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

Generate the StackChan connection files first:

```bash
npx iroharness connect stackchan ~/.iroharness/apps/iroha \
  --host-url http://MAC_MINI_IP:4182 \
  --wifi-ssid YOUR_WIFI_SSID \
  --wifi-pass YOUR_WIFI_PASSWORD \
  --firmware-config-out ~/.iroharness/source/firmware/stackchan-runtime/examples/basic/data/config.json
```

This writes:

```text
~/.iroharness/apps/iroha/.iroharness/connections/stackchan.device.json
~/.iroharness/apps/iroha/.iroharness/connections/stackchan-firmware-config.json
~/.iroharness/apps/iroha/.iroharness/connections/stackchan-provisioning.md
```

Use a LAN or Tailscale address that the M5Stack can reach. Do not use
`127.0.0.1` from the device.

The future AIAvatarStackChan-style `/config.json` should be generated from the
connection file. The important mapping is:

```json
{
  "wifi_networks": [
    { "name": "home", "ssid": "YOUR_WIFI_SSID", "pass": "YOUR_WIFI_PASSWORD" }
  ],
  "ws_host": "MAC_MINI_IP",
  "ws_port": 4182,
  "ws_path": "/device/stackchan/realtime?token=YOUR_STACKCHAN_DEVICE_TOKEN",
  "user_id": "stackchan",
  "channel": "local"
}
```

The IroHarness-owned firmware runtime is in:

```text
~/.iroharness/source/firmware/stackchan-runtime/
```

Build and flash from:

```bash
cd ~/.iroharness/source/firmware/stackchan-runtime/examples/basic
pio run
pio run --target upload
pio run --target uploadfs
```

Run doctor after `connect stackchan`:

```bash
npx iroharness doctor ~/.iroharness/apps/iroha
```

Doctor fails if the saved StackChan URL points at `localhost`, `127.*`,
`0.0.0.0`, or `::1`, because those addresses point back to the M5Stack itself
instead of the Mac mini.

Connection responsibilities:

| Side | Responsibility |
|---|---|
| IroHarness host | identity, memory, PJOS, Slack, model routing, STT/TTS provider config, permissions |
| Trusted StackChan gateway | device token validation, realtime session admission, device event mapping |
| StackChan firmware | Wi-Fi, display, buttons/touch, mic, speaker, camera, servo, local reconnect |
| `/stackchan/face` | current face/mode/text |
| `/device/stackchan/invoke` | touch/button/vision/audio events from the device |
| `/device/stackchan/realtime` | WebSocket path for audio frames, TTS chunks, face/lip-sync state |
| `/body/stackchan/events` | richer state streaming |

IroHarness no longer treats a separate minimal PlatformIO face poller as the
main firmware path. The intended device runtime is the IroHarness-owned
AIAvatarStackChan-derived runtime under `firmware/stackchan-runtime`.
