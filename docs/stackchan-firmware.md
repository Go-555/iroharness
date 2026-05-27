# StackChan Firmware Strategy

IroHarness can use AIAvatarStackChan as the main reference for the physical
StackChan path, but it should absorb the design in layers instead of copying the
whole runtime into the macro harness.

Reference: <https://github.com/uezo/AIAvatarStackChan>

AIAvatarStackChan is an MIT-licensed PlatformIO/Arduino library for StackChan
and AIAvatarKit. It already covers voice conversation, push-to-talk, pluggable
server-side STT/LLM/TTS, expressions, blinking, mouth animation, vision, touch
events, and agent harness integration.

## Boundary

Keep this split:

| Layer | Owns |
|---|---|
| IroHarness | identity, memory, Project OS, Slack/users/permissions, model routing, micro harness delegation |
| StackChan firmware | Wi-Fi, display, touch, mic, speaker, camera, servo, LEDs, local reconnect |
| Relay protocol | state, speech, invoke, audio, image, device health |

StackChan must not own the character. It renders and invokes the same character
state that Slack, browser, OBS, Live2D, and other bodies use.

## What To Absorb From AIAvatarStackChan

Useful ideas to bring into IroHarness:

- PlatformIO project shape for `m5stack-cores3`
- SD-card `config.json`
- Wi-Fi profile list
- WebSocket host/port/path configuration
- user/channel identifiers
- mic sample rate and buffer sizing
- VAD threshold and push-to-talk limits
- playback queue depth and start threshold
- speaker volume levels
- reconnect and keepalive intervals
- display brightness/rotation/status overlay
- touch/nade invoke prompt
- vision invoke prompt
- callback model for speech detected, accepted, final text, tool call, overlay
- short, non-blocking loop design

Do not absorb directly into core:

- firmware task scheduling
- board-specific pins
- audio driver internals
- display sprite drawing
- StackChan-BSP-specific servo handling
- AIAvatarKit-specific server protocol assumptions

Those belong in firmware or a device relay package.

## Phased Implementation

### Phase 0: Simple Face Polling

This is the current IroHarness prototype path.

```text
Slack -> IroHarness -> /stackchan/face -> StackChan display
```

StackChan polls:

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

This is enough to verify that Slack and the physical body share one character
state.

### Phase 1: SSE Body Relay

Use the existing body bridge stream:

```text
GET /body/stackchan/events
```

This avoids polling and gives firmware or a Raspberry Pi relay immediate state
changes.

### Phase 2: IroHarness Device Invoke

Add device-originated events:

```text
POST /device/stackchan/invoke
```

Planned payloads:

```json
{
  "type": "touch",
  "deviceId": "stackchan",
  "text": "$頭を撫でられました。短く反応してください。"
}
```

```json
{
  "type": "vision",
  "deviceId": "stackchan",
  "text": "$見えているものに反応してください。",
  "imageDataUrl": "data:image/jpeg;base64,..."
}
```

This maps AIAvatarStackChan's `sendInvoke`, `sendInvokeWithImage`, and
`sendInvokeWithAudio` idea into an IroHarness-owned contract.

### Phase 3: AIAvatarStackChan-Compatible WebSocket

Add an optional compatibility server so the upstream AIAvatarStackChan firmware
can connect with minimal changes:

```text
StackChan firmware -> WebSocket -> IroHarness device gateway
```

This phase should cover:

- mic PCM input
- partial/final transcript events
- TTS audio chunks
- accepted/final/tool-call metadata
- mouth/lip-sync state
- vision request/response
- reconnect and keepalive

This is the point where the full AIAvatarStackChan firmware becomes the main
reference instead of the simplified face poller.

### Phase 4: Dedicated Firmware Package

Split only when the toolchain forces it:

```text
iroharness-stackchan-firmware/
```

Reasons to split:

- PlatformIO release cadence differs from npm package cadence
- firmware binaries and board assets are large
- Arduino dependencies should not affect the Node/Rust package
- hardware CI is different from IroHarness core CI

Until then, keep contracts and examples in the main monorepo.

## Config Mapping

| AIAvatarStackChan config | IroHarness target |
|---|---|
| `wifi_networks` | firmware only |
| `ws_host`, `ws_port`, `ws_path` | device gateway URL |
| `user_id`, `channel` | audience/device identity |
| `mic_sample_rate`, `mic_buffer_samples` | realtime audio contract |
| `vad_threshold_db` | voice trigger policy |
| `playback_queue_depth`, `start_threshold` | TTS playback queue contract |
| `speaker_volume`, `volume_levels` | firmware settings |
| `display_rotation`, `display_brightness` | body config |
| `status_overlay_enabled` | body config |
| `vision_invoke_prompt` | device invoke template |
| `nade_invoke_prompt` | device invoke template |
| `debug_log` | firmware logging |

## Near-Term Work

1. Keep `examples/slack-stackchan-companion.mjs` as the Mac mini host process.
2. Add `protocols/device-config.schema.json`.
3. Add `protocols/device-invoke.schema.json`.
4. Add a minimal PlatformIO sketch that polls `/stackchan/face`.
5. Add a WebSocket/SSE relay sketch.
6. Add AIAvatarStackChan-compatible WebSocket mode.

The first firmware should be intentionally small. It should prove networking,
display, and shared identity before attempting STT/TTS, camera, servo, and
full-duplex audio.
