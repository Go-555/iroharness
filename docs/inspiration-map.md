# Inspiration Map

IroHarness is not a clone of any avatar kit, game SDK, or agent runtime. It is a
character macro harness. These projects are useful references for specific
edges of the system.

## CursorTuberKit

Reference: <https://github.com/ozekimasaki/CursorTuberKit>

Useful ideas:

- browser-first streaming avatar workflow
- Cursor-driven AI reply loop
- SVG and MotionPNGTuber avatar modes
- VOICEVOX speech synthesis and playback-driven lip sync
- YouTube, Twitch, and Kick live comment intake
- serialized spoken playback so generated replies do not overlap
- settings-driven avatar/background configuration
- tracked character seed rules with local override discipline

IroHarness mapping:

- Browser companion and OBS overlay cover the browser-first surface.
- MotionPNGTuber, Live2D, VRM, M5Stack, Even G2, and AIAvatarKit bridges keep
  body rendering replaceable.
- Voice/text brain slots keep model choice outside the character identity.
- Audience registry and permissions add durable user identity across platforms.
- Project OS adds durable work state beyond stream chat history.

What IroHarness should borrow next:

- richer in-app body settings for MotionPNGTuber scale, chroma key, sensitivity,
  and background media
- serialized speech playback queue as a first-class realtime primitive
- explicit character-rule diff review before committing persona changes

## Neuro SDK

Reference: <https://github.com/VedalAI/neuro-sdk>

Useful ideas:

- clear API documentation before broad integrations
- official SDKs for major engines plus community-maintained SDK links
- a test bot that mimics the API for integration testing
- explicit warnings that high-frequency action domains need a lower-level
  controller rather than only text action decisions

IroHarness mapping:

- Protocol schemas, golden fixtures, and adapter contract tests play the role
  of the stable API surface.
- `iroharness/testing` lets adapter authors validate micro harnesses, brains,
  and devices.
- Realtime core, body bridges, and stream controllers handle lower-level fast
  loops while the macro harness keeps high-level identity and policy.

What IroHarness should borrow next:

- a public compatibility registry for community adapters
- a Randy-like simulator that emits deterministic audience, body, and realtime
  events for third-party integration tests
- clearer guidance that low-level game, robot, and audio loops should stay
  outside the macro reasoning loop

## AIAvatarStackChan

Reference: <https://github.com/uezo/AIAvatarStackChan>

Useful ideas:

- paired server plus device firmware architecture
- pluggable STT, LLM, and TTS on the server side
- ultra-low-latency streaming conversation and push-to-talk
- device-side VAD, mute, volume, Wi-Fi, touch, and sensor interactions
- vision trigger that sends camera images when visual context is needed
- callbacks and module-based user app extension points
- hardware abstraction around display, face, motion, LED, camera, and audio

IroHarness mapping:

- Generated apps already configure voice/text brain slots and body bridges.
- Realtime STT/TTS contracts, barge-in, latency metrics, and Rust C ABI fast
  path cover the server-side fast loop boundary.
- M5Stack and Even G2 bridges treat physical devices as bodies for the same
  character.
- Permissions keep stream/device operations separate from personality.

What IroHarness should borrow next:

- device configuration schema for Wi-Fi-free host config, user identity,
  channel, VAD, PTT, audio buffer, and device capabilities
- event-driven invoke API for touch, sensor, timer, and vision triggers
- device simulator for testing physical-body interactions without hardware

## Repository Strategy

Use one main repository first:

```text
iroharness
  core macro harness
  protocol schemas
  CLI generator
  browser/OBS demo
  platform adapters
  body adapters
  realtime core contracts
  docs and package release
```

Split repositories only when a subproject needs its own release cadence,
toolchain, or audience:

- `iroharness-stackchan-firmware` for PlatformIO / Arduino firmware
- `iroharness-unity-sdk` for Unity users
- `iroharness-godot-sdk` for Godot users
- `iroharness-community-adapters` when external adapters become numerous

Until then, keeping the package monorepo-style makes the boundary easier to
understand: one character macro harness, many bodies and workers.
