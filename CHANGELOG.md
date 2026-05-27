# Changelog

## 0.1.0

Initial OSS skeleton for a character macro harness.

### Macro Harness Core

- dependency-free Node.js macro harness core
- file-backed and in-memory Project OS
- file-backed character profile loader for `SOUL.md`, `IDENTITY.md`,
  `MEMORY.md`, and `VOICE.md`
- voice/text/deep brain routing with replaceable HTTP brain adapters
- safe `/health` metadata for service, body, runtime, Project OS, and brain
  slot visibility

### Audience, Streams, And Permissions

- audience registry, normalized platform identities, role permissions,
  permission overrides, and stream sessions
- permission override expiry and revoke support
- browser admin UI for users, platform IDs, scoped permissions, permission
  revoke, and stream sessions
- file-backed audience audit log plus export/import for backups and local
  restores
- PostgreSQL/Supabase schema and registry adapter for production audience state,
  including persisted audit logs
- privacy and security guide for character memory, user IDs, credentials, and
  stream permissions
- deployment guide and templates for Mac mini `launchd`, Linux `systemd`,
  Tailscale-only exposure, and Caddy/nginx reverse proxies
- PostgreSQL/Supabase audience backup and restore recipes using `pg_dump` and
  `pg_restore`

### Platforms, Bodies, And Harness Interop

- Slack, Discord, YouTube, browser, OBS, VS Code, M5Stack, Even G2, Live2D, VRM,
  MotionPNGTuber, AIAvatarKit, Codex, Claude Code, OpenClaw, and Hermes adapter
  contracts or examples
- Discord bot runtime, Slack Events runtime, and YouTube Live Chat polling
  runtime
- OBS browser overlay and OBS WebSocket stream controller
- adapter authoring guide, runnable adapter skeleton, and capability matrix

### Realtime And Local Demos

- streaming STT/TTS contracts, barge-in, latency metrics, and realtime core
  bindings
- Rust realtime core crate scaffold, JSONL process binary, and native/WASM C ABI
  path
- browser avatar demo with configurable voice/text/deep HTTP brain slots
- dependency-free HTTP brain gateway demo for local model-slot routing
- provider brain gateway recipe for OpenAI Responses, Anthropic Messages, and
  local OpenAI-compatible chat completions

### OSS Operations

- CLI `init`, `doctor`, `doctor --json`, and `audience`
  `user/link/grant/revoke/stream/export/import/list`
- protocol schemas, golden fixtures, contract tests, and CI
- browser screenshot E2E workflow for chat, OBS overlay, and audience admin
  views
- npm release workflow with provenance, contribution guide, code of conduct,
  security notes, and issue/PR templates
