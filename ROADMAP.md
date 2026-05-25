# Roadmap

IroHarness should become the third OSS category beside OpenClaw, Hermes, and
avatar kits: a character macro harness that connects bodies, Project OS, and
micro harnesses.

## Milestone 0: Contract Skeleton

- [x] dependency-free macro harness core
- [x] character state protocol
- [x] in-memory PJOS
- [x] brain adapter contract
- [x] micro harness adapter contract
- [x] device/body adapter contract
- [x] MotionPNGTuber, M5Stack, and Even G2 mapper sketches
- [x] file-backed PJOS
- [x] HTTP micro-harness adapter
- [x] JSONL process micro-harness adapter
- [x] Codex app-server micro-harness adapter
- [x] OpenClaw HTTP bridge adapter
- [x] Hermes gateway bridge adapter
- [x] AIAvatarKit body bridge adapter
- [x] voice/text/deep brain switching
- [x] browser avatar demo
- [x] streaming event endpoint
- [x] body bridge snapshots and SSE endpoints
- [x] audience user registry
- [x] normalized user identity registry
- [x] PostgreSQL/Supabase audience schema
- [x] PostgreSQL/Supabase audience registry adapter
- [x] permission overrides
- [x] stream session registry
- [x] role-based permission policy
- [x] OBS browser overlay mode
- [x] OBS WebSocket control adapter
- [x] Discord message normalization adapter
- [x] Slack message normalization adapter
- [x] YouTube live chat normalization adapter
- [x] platform webhook endpoints
- [x] Discord bot runtime
- [x] Slack Events runtime
- [x] YouTube Live Chat polling runtime

## Milestone 1: Useful Local Demo

- [x] browser avatar demo
- [x] streaming event endpoint
- [x] voice/text model switch demo
- [x] Codex app-server adapter
- [x] file-backed PJOS
- [x] MotionPNGTuber renderer bridge
- [x] Discord message normalization adapter
- [x] YouTube live chat normalization adapter
- [x] YouTube Live Chat API polling runtime
- [x] OBS control/websocket adapter
- [x] audience registry demo

## Milestone 2: Harness Interop

- [x] OpenClaw adapter
- [x] Hermes adapter
- [x] Claude Code adapter
- [x] AIAvatarKit bridge
- [x] adapter contract tests
- [x] golden task fixtures

## Milestone 3: Multi-Body Character

- [x] Live2D adapter
- [x] VRM/3D adapter
- [x] M5Stack body adapter
- [x] Even G2 display adapter
- [ ] VS Code companion panel
- [x] Slack/Discord adapters
- [x] Discord bot runtime

## Milestone 4: Realtime Core

- [ ] streaming STT interface
- [ ] streaming TTS interface
- [ ] interruption and barge-in
- [ ] realtime latency metrics
- [ ] Rust event/audio/device core

## Guiding Principle

The macro harness owns identity. Models and external harnesses are engines,
workers, peers, or bodies. They are not automatically the same character.
