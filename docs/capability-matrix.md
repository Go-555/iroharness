# Capability Matrix

This matrix shows what is implemented in the OSS package and what still depends
on an external service, device, or harness.

Status labels:

- `built-in`: implemented in this repository with no service dependency
- `adapter`: normalizes or bridges an external runtime
- `runtime`: can run an event loop or local server
- `contract`: protocol or scaffold exists, but production deployment still
  depends on a host implementation

## Core

| Capability | Status | Public API / Artifact | Notes |
|---|---|---|---|
| Character macro harness | built-in | `createIroHarness` | Owns identity, routing, permissions, PJOS, and state updates. |
| File character profile | built-in | `createFileCharacterProfile` | Loads `SOUL.md`, `IDENTITY.md`, `MEMORY.md`, and `VOICE.md`. |
| Project OS | built-in | `createInMemoryProjectOs`, `createFileProjectOs`, `createProjectOsMarkdown` | Tracks tickets, runs, artifacts, and durable state. |
| Audience registry | built-in | `createInMemoryUserRegistry`, `createFileUserRegistry`, `createPostgresUserRegistry` | Links platform IDs to one user. |
| Permissions | built-in | `createPermissionPolicy`, `createAudienceContextPolicy` | Gates deep discussion, work delegation, stream control, and user management. |
| Brain routing | built-in | `createHeuristicRouter`, `createEchoBrain`, `createHttpBrain`, generated `.env` brain slots | Supports voice/text/deep/work routing while keeping identity stable. |
| Codex OAuth brain | adapter | `createCodexAppServerBrain`, `docs/brains.md` | Uses the host machine's Codex OAuth session as a selectable text/deep brain model. |
| Provider brain gateway | example | `examples/provider-brain-gateway.mjs` | Routes voice/text/deep slots to OpenAI, Claude, or local OpenAI-compatible providers. |
| Realtime voice contract | contract | `createRealtimeVoiceSession`, STT/TTS interfaces, schemas | JavaScript contract exists; production STT/TTS providers are replaceable. |
| Rust realtime core | contract | `crates/realtime-core`, `createRustRealtimeCoreBinding`, `createRustRealtimeCoreCabiAdapter` | Rust crate exposes JSONL plus native/WASM C ABI fast-path bindings. |

## Micro Harnesses

| Target | Status | Public API / Example | Notes |
|---|---|---|---|
| Generic HTTP harness | adapter | `createHttpMicroHarness` | Sends IroHarness task/context envelopes to any HTTP worker. |
| Codex app-server | adapter | `createCodexAppServerMicroHarness`, `examples/codex-app-server.mjs` | Delegated coding/review worker; Codex remains a micro harness. |
| Scoped Work Runner | adapter | `createScopedWorkRunnerMicroHarness` | Wraps Codex/browser/repo workers with view policy, delegate_work, and allowed-workspace checks. |
| Slack + Codex companion | example | `examples/slack-codex-companion.mjs`, `docs/slack-codex.md` | Slack-facing macro harness that uses local Codex OAuth through `codex app-server`. |
| Claude Code CLI | adapter | `createClaudeCodeCliMicroHarness`, `examples/claude-code-cli.mjs` | Runs CLI delegation when explicitly enabled by env. |
| OpenClaw | adapter | `createOpenClawMicroHarness` | Bridge target; OpenClaw does not own IroHarness character identity. |
| Hermes | adapter | `createHermesGatewayMicroHarness` | Bridge target; useful as learning/skills worker. |
| JSONL process | adapter | `createJsonlProcessMicroHarness` | Local process worker contract for custom harnesses. |
| Plain text process | adapter | `createTextProcessMicroHarness` | Simple process delegation path for scripts and CLIs. |

## Platforms And Community

| Platform | Status | Public API / Example | Notes |
|---|---|---|---|
| Browser companion | runtime | `createIroHarnessDevServer`, `npm run demo:browser` | Local chat, overlay, admin UI, state, events, OpenAPI. |
| Discord | runtime | `createDiscordMessageAdapter`, `createDiscordBotRuntime` | Multi-person fan rooms and developer channels. |
| Slack | runtime | `createSlackMessageAdapter`, `createSlackEventsRuntime` | Events API payload handling and replies. |
| Slack + StackChan companion | example | `examples/slack-stackchan-companion.mjs`, `docs/slack-stackchan.md` | Slack text interface plus StackChan/M5Stack face JSON and SSE body output. |
| YouTube Live Chat | runtime | `createYouTubeLiveChatAdapter`, `createYouTubeLiveChatPollingRuntime` | Polling runtime for live chat turns. |
| VS Code | adapter | `createVsCodeCompanionAdapter`, `examples/vscode-companion` | Companion panel and developer turns. |
| Audience CLI | built-in | `iroharness audience user/link/grant/revoke/stream/export/import/list` | Sets up users, platform IDs, permissions, streams, audit logs, and file-backed backups before going live. |

## Bodies And Stream Output

| Body / Output | Status | Public API / Example | Notes |
|---|---|---|---|
| Event stream | built-in | `createEventStreamDevice`, `GET /events` | Server-sent events for browser/body renderers. |
| OBS overlay | runtime | `/?view=overlay`, `createObsStreamController` | Browser Source plus permission-gated stream operations. |
| OBS WebSocket | adapter | `createObsWebSocketAdapter` | Scene, overlay, and mute operations after `manage_stream` approval. |
| MotionPNGTuber | adapter | `createMotionPngTuberMapper`, `createMotionPngTuberRendererBridge` | Maps normalized character state to PNG state. |
| M5Stack | adapter | `createM5StackFaceMapper`, `createM5StackBodyBridge` | Maps character state to compact device face payloads. |
| StackChan face poller firmware | example | `examples/stackchan-face-poller/` | PlatformIO/CoreS3 sketch that polls `/stackchan/face`, posts touch invokes, and uses Wi-Fi/HTTP retry backoff. |
| Device config/invoke protocol | contract | `protocols/device-config.schema.json`, `protocols/device-invoke.schema.json` | Stable contract for physical body settings and device-originated events. |
| StackChan firmware strategy | guide | `docs/stackchan-firmware.md` | Uses AIAvatarStackChan as the reference while keeping firmware, body rendering, and macro identity separated. |
| Even G2 | adapter | `createEvenG2DisplayMapper`, `createEvenG2DisplayBridge` | Maps state and speech to display payloads. |
| Live2D | adapter | `createLive2DMapper`, `createLive2DBodyBridge` | Maps state to expression, motion, and lip sync. |
| VRM/3D | adapter | `createVrmMapper`, `createVrmBodyBridge` | Maps state to expression, animation, and gaze. |
| AIAvatarKit | adapter | `createAIAvatarKitBridgeDevice` | Bridges speech/state events to an external avatar runtime. |

## Storage And Deployment

| Capability | Status | Public API / Artifact | Notes |
|---|---|---|---|
| File-backed local app | built-in | `iroharness init` | Generates a runnable local companion app. |
| OpenClaw-style installer | script | `install.sh`, `docs/install.md` | Installs from GitHub or npm, creates a per-user companion app, and points to StackChan setup. |
| Connection onboarding | CLI | `iroharness connect slack`, `iroharness connect stackchan` | Generates first Slack env/checklist and StackChan device/firmware config files. |
| Zone view export | CLI | `iroharness view export` | Creates public/trusted/owner runtime views with allowlisted files, redacted source paths for public/trusted views, redacted connection metadata, gateway/work-runner policies, and zone-filtered Project OS snapshots. |
| Work Runner policy check | CLI | `iroharness work-runner check` | Reads exported view policies before attaching privileged Codex, browser, or repo workers. |
| Doctor checks | built-in | `iroharness doctor --production --json` | CI/deployment preflight for generated apps, including StackChan firmware URL checks when connected. |
| PostgreSQL/Supabase audience schema | contract | `protocols/sql/postgres-audience.sql` | Production table layer for users, identities, permissions, stream sessions, and audit logs. |
| PostgreSQL audience backup/restore | guide | `docs/postgres-backup-restore.md`, `examples/postgres-audience-backup.sh`, `examples/postgres-audience-restore.sh` | `pg_dump` and `pg_restore` recipes scoped to audience tables. |
| Deployment examples | guide | `docs/deployment.md`, `examples/deployment/` | Mac mini launchd, Linux systemd, Tailscale exposure, and reverse proxy templates. |
| Browser screenshot E2E | workflow | `.github/workflows/browser-e2e.yml`, `npm run e2e:browser-screenshots` | Captures chat, OBS overlay, and audience admin views with Playwright. |
| Generated app smoke test | built-in | `npm run smoke:generated-app` | Verifies `iroharness init`, doctor, production checks, AGENTS.md, and audience setup as a package consumer. |
| OSS readiness check | built-in | `npm run oss:ready` | Verifies public files, package metadata, workflow coverage, package inclusions, and tracked secret/state exclusions. |
| Publish preflight | built-in | `npm run oss:publish-preflight` | Verifies clean tree, GitHub remote, unused version tag, GitHub auth, and npm auth before release. |
| OpenAPI | contract | `protocols/openapi.json`, `GET /openapi.json` | Local server route contract. |
| GitHub CI | built-in | `.github/workflows/ci.yml` | Node, packaging, and Rust checks. |
| npm release workflow | built-in | `.github/workflows/release.yml` | Publishes with provenance after Node/Rust gates. |
| Inspiration map | guide | `docs/inspiration-map.md`, `docs/inspiration-map.html` | Explains what IroHarness borrows from CursorTuberKit, Neuro SDK, and AIAvatarStackChan. |
| Absorption architecture | guide | `docs/absorption-architecture.md` | Defines the monorepo lanes for observing, contracting, adapting, simulating, and promoting upstream ideas. |

## Current Non-Goals

- IroHarness does not replace Codex, OpenClaw, Hermes, or Claude Code.
- IroHarness does not bundle proprietary STT, TTS, LLM, Discord, YouTube, OBS,
  or avatar credentials.
- IroHarness does not make every bridge the same character. Character identity
  remains in the macro harness; external tools are engines, workers, peers, or
  bodies.
