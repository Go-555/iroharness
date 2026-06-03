# Slack + StackChan Companion

This recipe runs one IroHarness character through Slack and a StackChan-style
M5Stack body at the same time.

It is the first trusted device route:

- Slack is the text interface.
- IroHarness owns identity, memory, permissions, routing, and Project OS.
- StackChan is a trusted body/device runtime that renders state and sends local
  mic, touch, button, and vision events.
- Codex can be added later as a text brain or delegated micro harness.

## Current Maturity

This is usable for a local prototype. It is not yet a polished production
product.

Good now:

- Slack Events API input and thread replies
- StackChan face JSON polling
- StackChan Server-Sent Events stream
- StackChan device invoke for touch, push-to-talk/audio, and vision payloads
- StackChan realtime WebSocket route and hardware-free simulator
- IroHarness-owned StackChan firmware runtime under `firmware/stackchan-runtime`
- shared character state between Slack and StackChan
- optional Codex OAuth model use through `codex app-server`

Still early:

- no built-in STT/TTS on the M5Stack device; providers stay host-side
- hardware playback still needs codec validation when using WAV TTS providers
- no OTA or provisioning flow yet

For the firmware plan and how AIAvatarStackChan will be absorbed into an
IroHarness-owned device runtime, see
[stackchan-firmware.md](./stackchan-firmware.md).

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

By default the gateway registers the local StackChan identity
`m5stack:stackchan` as a `member`, so the physical device is treated as a
trusted local body instead of an anonymous public entry point. Override
`IROHARNESS_STACKCHAN_USER_ID`, `IROHARNESS_STACKCHAN_USER_NAME`,
`IROHARNESS_STACKCHAN_USER_ROLE`, or `IROHARNESS_STACKCHAN_USER_PLATFORM_ID`
when a device should map to a different audience identity.

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

The realtime StackChan handler normalizes AivisSpeech WAV output to raw PCM16
before sending AIAvatarStackChan-style `chunk` messages. The firmware can then
play speech through its existing PCM speaker path without a device-side WAV
decoder.

This HTTP invoke path is useful for first hardware checks. For the 1-second
conversation target, use the WebSocket realtime relay in
[realtime.md](./realtime.md) so mic audio, STT events, TTS chunks, and playback
state stay open instead of waiting for request/response turns.

`iroharness connect stackchan` writes `realtime_ws_url` into
`.iroharness/connections/stackchan-firmware-config.json`. Use that URL for the
AIAvatarStackChan-style realtime path.

The companion process now mounts that route:

```text
GET /device/stackchan/realtime
```

The WebSocket requires the same device token. Send it as `?token=...`,
`x-iroharness-device-token`, or `Authorization: Bearer ...`.
Realtime mode requires both an STT provider and a TTS provider. Without those,
the server rejects the WebSocket upgrade with `503`.

For a hardware-free smoke test, run the companion with mock speech providers:

```bash
SLACK_BOT_TOKEN=xoxb-dev \
SLACK_SIGNING_SECRET=dev-secret \
STACKCHAN_DEVICE_TOKEN=dev-device-token \
IROHARNESS_STACKCHAN_STT_PROVIDER=mock \
IROHARNESS_STACKCHAN_TTS_PROVIDER=mock \
npm run example:slack-stackchan
```

Then connect the simulator from another terminal:

```bash
STACKCHAN_DEVICE_TOKEN=dev-device-token \
npm run example:stackchan-sim -- \
  --url ws://127.0.0.1:4182/device/stackchan/realtime \
  --text "こんにちは" \
  --summary \
  --fail-over-budget
```

To exercise the AIAvatarStackChan-style wire shape, add:

```bash
STACKCHAN_DEVICE_TOKEN=dev-device-token \
npm run example:stackchan-sim -- \
  --protocol aiavatarstackchan \
  --url ws://127.0.0.1:4182/device/stackchan/realtime \
  --text "こんにちは" \
  --summary
```

The simulator sends `hello`, `invoke`, `audio.chunk`, and `interrupt` messages
in IroHarness-native mode. In AIAvatarStackChan mode it sends `start`,
`invoke`, an audio `invoke`, and `stop`, then expects `connected`, `accepted`,
`start`, `chunk`, and `final`. With `--summary`, it also prints a
`simulator.summary` JSON line with host-side marks for `sttFinal`,
`responseStart`, `firstAudio`, and `responseFinal`.
`--fail-over-budget` exits non-zero when `firstAudio` exceeds the configured
budget. This does not prove real microphone, speaker, Azure, AivisSpeech, or
Wi-Fi latency, but it does prove the host-side realtime route without StackChan
hardware.

IroHarness treats this as a normal device-originated turn. The same character
identity, brain routing, Project OS state, and permissions are used.
The invoke endpoint rejects requests without the configured device token.

## AIAvatarStackChan Absorption Path

IroHarness no longer keeps a one-off minimal face poller as the public firmware
path. The device runtime should instead follow AIAvatarStackChan's proven shape:

```text
Config -> AIAvatar orchestrator -> WebSocketClient -> mic/speaker/face/motion
```

In that design, firmware owns Wi-Fi, display, touch, mic, speaker, camera,
servo, LEDs, and local buffering. IroHarness owns the character, audience,
permissions, Project OS, provider routing, STT, LLM, and TTS credentials.

The next implementation step is an upstream-compatible trusted gateway and an
AIAvatarStackChan-style generated `/config.json`, not another separate firmware
prototype. The IroHarness-owned runtime now lives at
`firmware/stackchan-runtime`.

`iroharness connect stackchan` also writes:

```text
.iroharness/connections/stackchan-provisioning.md
```

That file is the generated first-flash and update runbook for non-engineers. It
keeps today's path explicit: firmware config is copied and flashed manually now,
while OTA belongs in the future firmware package or device relay rather than the
macro harness core.

## Optional Codex OAuth

For normal text replies through Codex OAuth:

```bash
codex login

IROHARNESS_TEXT_BRAIN_PROVIDER=codex \
IROHARNESS_TEXT_BRAIN_MODEL=gpt-5.5 \
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

The two paths are separate. The text brain is read-only conversation. The
Codex micro harness is where file edits, reviews, and implementation work
belong.

## Permission Boundary

Slack users are resolved through the IroHarness audience registry. A user must
be `owner`, `developer`, or explicitly granted `delegate_work` before work can
be delegated to Codex.

StackChan does not grant permissions. It only renders the character state.
