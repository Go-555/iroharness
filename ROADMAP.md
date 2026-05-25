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
- [x] browser avatar demo
- [x] streaming event endpoint

## Milestone 1: Useful Local Demo

- [x] browser avatar demo
- [x] streaming event endpoint
- [ ] voice/text model switch demo
- [ ] Codex app-server adapter
- [x] file-backed PJOS
- [ ] MotionPNGTuber renderer bridge

## Milestone 2: Harness Interop

- [ ] OpenClaw adapter
- [ ] Hermes adapter
- [ ] Claude Code adapter
- [ ] AIAvatarKit bridge
- [ ] adapter contract tests
- [ ] golden task fixtures

## Milestone 3: Multi-Body Character

- [ ] Live2D adapter
- [ ] VRM/3D adapter
- [ ] M5Stack body adapter
- [ ] Even G2 display adapter
- [ ] VS Code companion panel
- [ ] Slack/Discord adapters

## Milestone 4: Realtime Core

- [ ] streaming STT interface
- [ ] streaming TTS interface
- [ ] interruption and barge-in
- [ ] realtime latency metrics
- [ ] Rust event/audio/device core

## Guiding Principle

The macro harness owns identity. Models and external harnesses are engines,
workers, peers, or bodies. They are not automatically the same character.
