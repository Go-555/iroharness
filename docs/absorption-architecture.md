# Absorption Architecture

IroHarness should stay monorepo-first while it absorbs ideas from adjacent
projects. The goal is not to copy implementations. The goal is to turn useful
patterns into stable IroHarness contracts.

## Absorption Lanes

Use five lanes inside the main repository:

```text
observe -> contract -> adapter -> simulator -> core promotion
```

## 1. Observe

Track upstream ideas in documentation first.

Sources:

- CursorTuberKit: browser avatar, MotionPNGTuber settings, VOICEVOX, speech
  queue, live comments
- Neuro SDK: external app API, SDK ecosystem, test bot, low-level control
  boundary
- AIAvatarStackChan: device/server split, VAD, PTT, touch, vision, hardware
  abstraction

Repository home:

- `docs/inspiration-map.md`
- `docs/inspiration-map.html`
- `docs/absorption-architecture.md`

Rule: no runtime dependency enters the core from this lane.

## 2. Contract

Promote a repeated idea into a protocol or public interface before building a
large implementation.

Good contract candidates:

- speech playback queue
- body configuration schema
- device capability schema
- vision/touch/sensor invocation envelope
- community adapter manifest
- integration simulator event format

Repository home:

- `protocols/`
- `fixtures/golden/`
- `src/index.d.ts`
- `src/adapters/index.d.ts`

Rule: contracts must be testable without external services.

## 3. Adapter

Wrap real systems behind thin adapters.

Examples:

- CursorTuberKit-like MotionPNGTuber settings become a body adapter setting
  surface, not a character policy.
- Neuro SDK-like game/app integrations become platform or body adapters.
- StackChan-like physical interactions become device event adapters.

Repository home:

- `src/adapters/`
- `examples/`
- `docs/build-an-adapter.md`
- `test/adapters.test.js`

Rule: adapters translate external shape into IroHarness shape. They do not own
identity, memory, permissions, or Project OS policy.

## 4. Simulator

Before depending on real streams, games, or hardware, build deterministic
simulators.

Simulator targets:

- audience simulator: YouTube/Discord/Slack style user events
- body simulator: MotionPNGTuber/Live2D/VRM/M5Stack/Even G2 state projection
- realtime simulator: STT partials, TTS chunks, barge-in, latency marks
- device simulator: touch, button, VAD, PTT, camera/vision trigger

Repository home:

- `src/testing/`
- `fixtures/golden/`
- `examples/*-simulator.mjs`
- `test/*`

Rule: every simulator should generate the same contract events real adapters
consume.

## 5. Core Promotion

Only promote a feature into core when it is shared by multiple adapters or
needed for macro-harness guarantees.

Promote when:

- the feature protects character identity
- the feature protects permissions or safety
- at least two bodies/platforms need the same primitive
- tests show the behavior is stable across adapters

Keep as adapter/example when:

- the feature belongs to one provider
- the feature is UI taste or body-specific configuration
- the feature has a heavy toolchain such as firmware, Unity, Godot, or native
  rendering

## Current Absorption Backlog

| Pattern | Source | Lane | Next Artifact |
|---|---|---|---|
| Serialized speech playback queue | CursorTuberKit | contract | `protocols/speech-queue.schema.json` |
| MotionPNGTuber visual settings | CursorTuberKit | adapter | browser admin/body settings panel |
| Community adapter registry | Neuro SDK | contract | `protocols/adapter-manifest.schema.json` |
| Deterministic integration bot | Neuro SDK | simulator | `examples/integration-simulator.mjs` |
| Device config schema | AIAvatarStackChan | contract | `protocols/device-config.schema.json` |
| Touch/PTT/VAD/vision invoke | AIAvatarStackChan | contract | `protocols/device-invoke.schema.json` |
| Device simulator | AIAvatarStackChan | simulator | `examples/device-simulator.mjs` |
| StackChan firmware plan | AIAvatarStackChan | guide | `docs/stackchan-firmware.md` |

## Monorepo Boundary

Keep these in the main repository now:

- protocol schemas
- public JS APIs
- adapter contracts
- examples
- browser demo
- generated app
- docs
- CI and package release

Split later only when release cadence or toolchain forces it:

- firmware
- Unity package
- Godot plugin
- large community adapter catalog

The monorepo remains the source of truth for the macro-harness boundary.
