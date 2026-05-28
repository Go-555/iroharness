# Slack + StackChan Companion

This recipe runs one IroHarness character through Slack and a StackChan-style
M5Stack face at the same time.

It is the recommended first hardware experiment:

- Slack is the text interface.
- IroHarness owns identity, memory, permissions, routing, and Project OS.
- StackChan is a body renderer that reads the current character state.
- Codex can be added later as a text/deep brain or delegated micro harness.

## Current Maturity

This is usable for a local prototype. It is not yet a polished production
product.

Good now:

- Slack Events API input and thread replies
- StackChan face JSON polling
- StackChan Server-Sent Events stream
- StackChan device invoke for touch, push-to-talk/audio, and vision payloads
- minimal StackChan/CoreS3 PlatformIO face poller sketch
- device-side Wi-Fi reconnect and HTTP retry backoff in the face poller
- shared character state between Slack and StackChan
- optional Codex OAuth model use through `codex app-server`

Still early:

- no full AIAvatarStackChan-compatible firmware yet
- no built-in STT/TTS on the M5Stack device; audio invoke can use a host STT relay
- no OTA or provisioning flow yet

For the firmware plan and how AIAvatarStackChan will be used as the main
reference, see [stackchan-firmware.md](./stackchan-firmware.md).

## Run Locally

```bash
SLACK_BOT_TOKEN=xoxb-... \
SLACK_SIGNING_SECRET=... \
STACKCHAN_DEVICE_TOKEN=... \
SLACK_BOT_USER_ID=UIROHA \
IROHARNESS_SLACK_OWNER_USER_ID=UOWNER \
npm run example:slack-stackchan
```

The example prints:

```text
Slack Events URL: http://127.0.0.1:4182/slack/events
StackChan face JSON: http://127.0.0.1:4182/stackchan/face
StackChan invoke URL: http://127.0.0.1:4182/device/stackchan/invoke
StackChan SSE: http://127.0.0.1:4182/body/stackchan/events
```

Expose `/slack/events` with Tailscale Serve, Cloudflare Tunnel, ngrok, or
another trusted HTTPS ingress and set it as Slack's Events API Request URL.

To run from an exported trusted view instead of the full source app:

```bash
npx iroharness view export ./my-companion \
  --zone trusted \
  --out /Users/iroharness-trusted/iroha-view \
  --force

IROHARNESS_VIEW_DIR=/Users/iroharness-trusted/iroha-view \
SLACK_BOT_TOKEN=xoxb-... \
SLACK_SIGNING_SECRET=... \
STACKCHAN_DEVICE_TOKEN=... \
SLACK_BOT_USER_ID=UIROHA \
npm run example:slack-stackchan
```

In this mode, character files are read from `current/` and runtime state is
written to the view's `state/` directory. The gateway does not need the full Core
SSOT folder.

## StackChan Polling Contract

The simplest StackChan firmware can poll:

```text
GET /stackchan/face
```

Response:

```json
{
  "face": ":D",
  "mode": "speaking",
  "text": "Irohaとして受け取ったよ。"
}
```

Face values are intentionally tiny:

| Mode | Face |
|---|---|
| `idle` | `:)` |
| `listening` | `o_o` |
| `thinking` | `...` |
| `speaking` | `:D` |
| `working` | `>_>` |
| `error` | `x_x` |

For a richer relay, subscribe to:

```text
GET /body/stackchan/events
```

That endpoint streams the same body payloads as Server-Sent Events.

## Device Invoke

StackChan can also send events back to IroHarness:

```text
POST /device/stackchan/invoke
x-iroharness-device-token: <STACKCHAN_DEVICE_TOKEN>
```

Example:

```json
{
  "type": "touch",
  "deviceId": "stackchan",
  "userId": "stackchan",
  "channel": "local",
  "text": "$頭を撫でられました。短く反応してください。"
}
```

Audio / push-to-talk input can use the same endpoint:

```json
{
  "type": "audio",
  "deviceId": "stackchan",
  "userId": "stackchan",
  "channel": "local",
  "audio": {
    "encoding": "wav",
    "sampleRate": 16000,
    "dataBase64": "..."
  }
}
```

Set `IROHARNESS_STACKCHAN_STT_ENDPOINT` to bridge the audio payload through a
host-side STT provider. The endpoint follows the same
`createHttpStreamingStt` contract documented in [realtime.md](./realtime.md).
If no STT endpoint is configured, IroHarness still treats the payload as a
voice-originated device event and uses a short fallback prompt.

For Azure Speech STT:

```bash
IROHARNESS_STACKCHAN_STT_PROVIDER=azure \
AZURE_SPEECH_REGION=japaneast \
AZURE_SPEECH_KEY=... \
AZURE_SPEECH_LANGUAGE=ja-JP \
npm run example:slack-stackchan
```

For AivisSpeech TTS on device audio/PTT responses:

```bash
IROHARNESS_STACKCHAN_TTS_PROVIDER=aivis \
AIVIS_SPEECH_BASE_URL=http://127.0.0.1:10101 \
AIVIS_SPEECH_SPEAKER=888753760 \
npm run example:slack-stackchan
```

This HTTP invoke path is useful for first hardware checks. For the 1-second
conversation target, use the WebSocket realtime relay in
[realtime.md](./realtime.md) so mic audio, STT events, TTS chunks, and playback
state stay open instead of waiting for request/response turns.

`iroharness connect stackchan` writes `realtime_ws_url` into
`.iroharness/connections/stackchan-firmware-config.json`. Use that URL for the
AIAvatarStackChan-style realtime path.

IroHarness treats this as a normal device-originated turn. The same character
identity, brain routing, Project OS state, and permissions are used.
The invoke endpoint rejects requests without the configured device token.

## Minimal Firmware Example

A first PlatformIO sketch is included at:

```text
examples/stackchan-face-poller/
```

It does two things:

- polls `/stackchan/face` and draws the face/text on an M5Stack CoreS3 display
- sends a touch/button invoke to `/device/stackchan/invoke`

Edit `examples/stackchan-face-poller/data/config.json`, then build/upload with
PlatformIO.

`iroharness connect stackchan` also writes:

```text
.iroharness/connections/stackchan-provisioning.md
```

That file is the generated first-flash and update runbook for non-engineers. It
keeps today's path explicit: firmware config is copied and flashed manually now,
while OTA belongs in the future firmware package or device relay rather than the
macro harness core.

The face poller supports local retry settings:

```json
{
  "poll_interval_ms": 500,
  "wifi_retry_base_ms": 1000,
  "wifi_retry_max_ms": 30000,
  "http_retry_base_ms": 1000,
  "http_retry_max_ms": 15000
}
```

The device backs off locally when Wi-Fi or the host endpoint is unavailable, so
temporary Mac mini restarts or network drops should not create a tight retry
loop.

## Optional Codex OAuth

For normal text/deep replies through Codex OAuth:

```bash
codex login

IROHARNESS_TEXT_BRAIN_PROVIDER=codex \
IROHARNESS_TEXT_BRAIN_MODEL=gpt-5.4 \
IROHARNESS_DEEP_BRAIN_PROVIDER=codex \
IROHARNESS_DEEP_BRAIN_MODEL=gpt-5.5 \
npm run example:slack-stackchan
```

For delegated coding work:

```bash
codex login

IROHARNESS_RUN_CODEX=1 \
CODEX_WORKSPACE=/path/to/project \
CODEX_MODEL=gpt-5.4 \
npm run example:slack-stackchan
```

The two paths are separate. The text/deep brain is read-only conversation. The
Codex micro harness is where file edits, reviews, and implementation work
belong.

## Permission Boundary

Slack users are resolved through the IroHarness audience registry. A user must
be `owner`, `developer`, or explicitly granted `delegate_work` before work can
be delegated to Codex.

StackChan does not grant permissions. It only renders the character state.
