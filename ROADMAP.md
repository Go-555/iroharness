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
- [x] expiring and revocable permission overrides
- [x] stream session registry
- [x] stream session context enrichment
- [x] role-based permission policy
- [x] stream operation routing and controller contract
- [x] OBS browser overlay mode
- [x] OBS WebSocket control adapter
- [x] OBS stream controller adapter
- [x] Discord message normalization adapter
- [x] Slack message normalization adapter
- [x] YouTube live chat normalization adapter
- [x] platform webhook endpoints
- [x] Discord bot runtime
- [x] Slack Events runtime
- [x] YouTube Live Chat polling runtime
- [x] safe health metadata for service, runtime, body, PJOS, and brain slots

## Milestone 1: Useful Local Demo

- [x] browser avatar demo
- [x] streaming event endpoint
- [x] voice/text model switch demo
- [x] configurable voice/text/deep HTTP brain slots
- [x] local HTTP brain gateway demo
- [x] provider brain gateway recipes for OpenAI, Claude, and local models
- [x] Codex app-server adapter
- [x] file-backed PJOS
- [x] MotionPNGTuber renderer bridge
- [x] Discord message normalization adapter
- [x] YouTube live chat normalization adapter
- [x] YouTube Live Chat API polling runtime
- [x] OBS control/websocket adapter
- [x] audience registry demo
- [x] browser admin UI for users, identities, permissions, revoke, and streams
- [x] file-backed audience backup and restore CLI
- [x] file-backed audit log for privileged audience changes
- [x] PostgreSQL persisted audit log for privileged audience changes
- [x] deployment examples for Tailscale, reverse proxy, systemd, and launchd
- [x] PostgreSQL audience backup/restore recipes
- [x] end-to-end browser screenshots outside sandboxed CI port restrictions

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
- [x] VS Code companion panel
- [x] Slack/Discord adapters
- [x] Discord bot runtime

## Milestone 4: Realtime Core

- [x] streaming STT interface
- [x] streaming TTS interface
- [x] interruption and barge-in
- [x] realtime latency metrics
- [x] Rust event/audio/device core skeleton
- [x] Rust event/audio/device runtime binding contract
- [x] external realtime core JSONL process adapter
- [x] Rust JSONL process binary scaffold
- [x] Rust native/WASM C ABI implementation

## Milestone 5: Production Hardening

- [x] provider brain recipes
- [x] deployment examples
- [x] PostgreSQL/Supabase backup and restore recipes
- [x] browser screenshot E2E workflow
- [x] Rust native/WASM realtime C ABI path
- [x] generated companion AGENTS.md instructions for coding agents
- [x] generated app smoke test for OSS package consumers

## Guiding Principle

The macro harness owns identity. Models and external harnesses are engines,
workers, peers, or bodies. They are not automatically the same character.
