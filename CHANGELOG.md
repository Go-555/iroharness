# Changelog

## 0.1.0

Initial OSS skeleton for a character macro harness.

### Macro Harness Core

- dependency-free Node.js macro harness core
- file-backed and in-memory Project OS
- file-backed character profile loader for `SOUL.md`, `IDENTITY.md`,
  `MEMORY.md`, and `VOICE.md`
- voice/text/deep brain routing with replaceable HTTP brain adapters
- Codex OAuth brain adapter for selecting text/deep models through the host
  machine's `codex app-server`
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
- Slack + Codex companion recipe that uses Slack Events API plus the host
  machine's Codex OAuth session
- Slack + StackChan companion recipe with M5Stack face JSON polling and SSE
  body output, including `IROHARNESS_VIEW_DIR` support for exported trusted
  views
- device config and device invoke protocol schemas for physical bodies
- StackChan/CoreS3 PlatformIO face poller sketch with touch invoke, Wi-Fi
  reconnect, and HTTP retry backoff
- StackChan firmware strategy using AIAvatarStackChan as the reference while
  keeping macro identity in IroHarness
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

- OpenClaw-style `install.sh` with GitHub checkout, npm install mode, generated
  companion app setup, dry-run, and StackChan next-step guidance
- installation guide covering source/app directory separation and first
  StackChan connection
- `iroharness connect slack` and `iroharness connect stackchan` for first
  onboarding files, `.env` setup, owner Slack identity, and firmware config
- `iroharness doctor` validates StackChan firmware host URLs and fails on
  loopback/local-only addresses that a physical M5Stack cannot reach
- generated apps no longer map unauthenticated browser guests to local owner
  identity; `.iroharness/` is ignored recursively
- Slack examples now require signing secrets, and StackChan invoke requires a
  per-device token
- `iroharness view export` creates public/trusted/owner runtime views with a
  `view-manifest.json`, read-only `current/` files, and writable `state/`
  directories for zero-trust gateway separation
- View export now emits zone-filtered `project-os.json` and `PROJECT_OS.md`, so
  public/trusted gateways can see only explicitly visible work board items
- View export now emits `gateway-policy.json` and `work-runner-policy.json`,
  redacts public/trusted source paths, and records that Codex OAuth, repository
  work, browser sessions, and host credentials are runner-only boundaries
- CLI `init`, `doctor`, `doctor --json`, and `audience`
  `user/link/grant/revoke/stream/export/import/list`
- generated `AGENTS.md` companion instructions for character, permission, and
  Project OS boundaries
- generated app smoke test for `init`, doctor, production checks, and audience
  setup
- OSS readiness check for package metadata, workflows, tracked secrets, and
  public-file coverage
- publish preflight check for GitHub remote, clean tree, version tag, GitHub
  auth, and npm auth
- inspiration map and HTML comparison view for CursorTuberKit, Neuro SDK, and
  AIAvatarStackChan
- monorepo absorption architecture for turning upstream ideas into contracts,
  adapters, simulators, and core features
- protocol schemas, golden fixtures, contract tests, and CI
- browser screenshot E2E workflow for chat, OBS overlay, and audience admin
  views
- npm release workflow with provenance, contribution guide, code of conduct,
  security notes, and issue/PR templates
