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
- [x] OSS readiness check for package and repository publication
- [x] publish preflight check for GitHub and npm credentials
- [x] inspiration map and HTML comparison view for adjacent avatar, game SDK,
  and robot projects
- [x] monorepo absorption architecture for upstream ideas

## Implementation Backlog Toward The Designed Product

The checklist above means the OSS skeleton, contracts, examples, and package
surface are in place. The designed product is not finished until the runtime
boundaries and first real devices are comfortable for daily use.

### P0: Slack + StackChan First Use

- [x] View export writes gateway and work-runner boundary policies
- [x] StackChan face poller handles Wi-Fi reconnect and HTTP retry backoff
- [x] Slack + StackChan companion can boot directly from an exported trusted view
- [x] Slack onboarding produces a copy-paste checklist for Slack App settings
- [x] StackChan setup validates that firmware is not pointed at loopback/local-only URLs

### P1: Zero-Trust Work Runner

- [x] Work Runner policy check reads `work-runner-policy.json`
- [x] Work Runner scopes Codex/browser/repo access per requested workspace
- [x] Gateway-to-runner delegation records permission checks in Project OS
- [x] Public gateway cannot delegate work even when prompted through chat

### P2: Voice And Physical Bodies

- [x] Production STT provider adapter
- [x] Production TTS provider adapter
- [x] Speech playback queue protocol and simulator
- [ ] StackChan richer audio invoke path based on AIAvatarStackChan
- [ ] OTA/provisioning strategy for physical devices

### P3: Public Streaming Surfaces

- [ ] YouTube live companion deployment preset
- [ ] X/public chat gateway deployment preset
- [ ] OBS/streamer runbook for public-safe memory and permissions

## Guiding Principle

The macro harness owns identity. Models and external harnesses are engines,
workers, peers, or bodies. They are not automatically the same character.
