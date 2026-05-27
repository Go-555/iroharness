# IroHarness

IroHarness is a character macro harness for building the "best AI companion":
one character identity, many bodies, durable project state, and delegation to
micro harnesses such as Codex, Claude Code, OpenClaw, Hermes, or OpenClaude.

The core idea:

```text
Character Macro Harness
  = identity + memory + Project OS + realtime state + expression bodies
    + model routing + micro-harness delegation
```

IroHarness is not trying to replace every agent runtime. It sits above them.

```text
Slack / Web / VS Code / M5Stack / Even G2 / Live2D / MotionPNGTuber
                              |
                              v
                         IroHarness
        identity, state, PJOS, routing, approvals, expression
                              |
        +---------------------+---------------------+
        v                     v                     v
      Codex               OpenClaw               Hermes
  micro harness        micro harness         learning agent
```

## Why This Exists

OpenClaw is strong as a personal AI gateway. Hermes is strong as a learning
agent. AIAvatarKit is strong as a speech-to-speech avatar framework.

IroHarness aims at a different center:

- the character is the primary product surface
- the same character can appear as Live2D, MotionPNGTuber, VRM/3D, M5Stack dot
  face, Even G2 display, VS Code panel, Slack text, or browser avatar
- voice, text, and work modes can use different models without breaking identity
- Project OS keeps goals, specs, tickets, runs, and artifacts as the durable state
- micro harnesses do specialized work, while the macro harness owns the character
  and the relationship with the user
- YouTube, Discord, Slack, and browser identities can resolve to the same user
  record, so fans, members, and developers get appropriate access without
  changing the character's personality

See [docs/design-principles.md](./docs/design-principles.md) for the design
rules behind these boundaries.

See [docs/capability-matrix.md](./docs/capability-matrix.md) for the current
implementation matrix across micro harnesses, platforms, bodies, storage, and
deployment.

To add a new integration, see
[docs/build-an-adapter.md](./docs/build-an-adapter.md).

## Status

This repository is an early OSS skeleton. It intentionally starts with a small
dependency-free Node.js core so the protocols can stabilize before a Rust
realtime core is introduced.

CI validates Node checks, Node tests, package contents, and the Rust realtime
core crate. See [docs/ci.md](./docs/ci.md).

See [RELEASE.md](./RELEASE.md), [CHANGELOG.md](./CHANGELOG.md), and
[SECURITY.md](./SECURITY.md) for OSS operation notes. See
[CONTRIBUTING.md](./CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before contributing.
For handling character memory, user IDs, credentials, and stream permissions,
see [docs/privacy-and-security.md](./docs/privacy-and-security.md).

## Install

```bash
npm install
```

There are no runtime dependencies today.

The package ships TypeScript declarations for the core, adapters, and testing
contracts.

## Quick Start

Create a local companion app:

```bash
npx iroharness init ./my-companion --character Iroha
cd my-companion
npm install
cp .env.example .env
npm run doctor
npm start
```

Open the printed URL, usually:

```text
http://127.0.0.1:4178/
```

Useful generated routes:

- `/` for browser chat
- `/?view=overlay` for an OBS Browser Source
- `/?view=admin` for audience users, platform IDs, permissions, and streams
- `/health` for readiness and optional runtime status
- `/openapi.json` for the local HTTP API contract

The generated app reads `.env` directly. Setting `YOUTUBE_API_KEY` plus
`YOUTUBE_LIVE_CHAT_ID` starts YouTube live chat polling, setting
`DISCORD_BOT_TOKEN` starts the Discord runtime, and `IROHARNESS_ENABLE_OBS=1`
enables OBS WebSocket stream control.

For a stream or Discord fan community, link platform IDs before going live:

```bash
npx iroharness audience user . \
  --id owner \
  --display-name "Owner" \
  --role owner \
  --youtube UCxxx \
  --discord 123456

npx iroharness audience stream . \
  --id youtube-live \
  --platform youtube \
  --channel "$YOUTUBE_LIVE_CHAT_ID" \
  --host owner

npx iroharness audience list . --json
```

Before exposing the server beyond a trusted local machine, set an admin token
and run the production doctor:

```bash
IROHARNESS_ADMIN_TOKEN="$(openssl rand -hex 24)" npm run doctor:production
npx iroharness doctor . --production --json
```

Or run the repository examples:

```bash
npm run example
npm run example:audience
npm run example:audience-admin
npm run example:adapter
npm run example:bodies
npm run example:brains
npm run example:pjos
npm run example:codex
npm run example:claude
npm run example:discord
npm run example:bridges
npm run example:slack
npm run example:youtube
npm run example:obs
npm run example:realtime-core
npm run demo:browser
```

See [docs/cli.md](./docs/cli.md) for the `iroharness init` command.

Or import the core:

```js
import {
  createIroHarness,
  createFileProjectOs,
  createConsoleDevice,
  createEchoBrain,
  createHeuristicRouter,
  createStubMicroHarness
} from "iroharness";

const projectOs = createFileProjectOs({ path: ".iroharness/pjos.json" });

const iroha = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "A practical, warm character companion who helps with work.",
    voiceStyle: "short, natural, responsive"
  },
  projectOs,
  router: createHeuristicRouter(),
  brains: {
    voice: createEchoBrain("voice-fast"),
    text: createEchoBrain("text-deep")
  },
  devices: [createConsoleDevice("console")],
  microHarnesses: [
    createStubMicroHarness("codex", ["code", "files", "review"])
  ]
});

await iroha.receive({
  source: "web",
  modality: "text",
  text: "この機能をCodexで実装して"
});
```

## Generated App Checklist

Use this checklist before inviting fans or collaborators:

```bash
npm run doctor
npx iroharness audience list . --json
IROHARNESS_ADMIN_TOKEN="$(openssl rand -hex 24)" npm run doctor:production
```

Then confirm:

- the character profile files are edited: `SOUL.md`, `IDENTITY.md`,
  `MEMORY.md`, `VOICE.md`
- OBS uses `http://127.0.0.1:4178/?view=overlay` as a Browser Source
- YouTube users and Discord users resolve to the same person when appropriate
- only trusted users have `delegate_work`, `manage_stream`, or `manage_users`
- `IROHARNESS_ADMIN_TOKEN` is set before using Tailscale, tunnels, or a reverse
  proxy

## Adapter Examples

Connect an HTTP runtime such as an OpenClaw or Hermes bridge:

```js
import { createHttpMicroHarness } from "iroharness/adapters";

const openclaw = createHttpMicroHarness({
  id: "openclaw",
  endpoint: "http://127.0.0.1:8787/run",
  capabilities: ["assistant", "tools", "memory"]
});
```

Connect named external bridges:

```js
import {
  createOpenClawMicroHarness,
  createHermesGatewayMicroHarness,
  createAIAvatarKitBridgeDevice
} from "iroharness/adapters";

const openclaw = createOpenClawMicroHarness({
  endpoint: "http://127.0.0.1:8787/agent/run"
});

const hermes = createHermesGatewayMicroHarness({
  endpoint: "http://127.0.0.1:8765/message"
});

const avatar = createAIAvatarKitBridgeDevice({
  eventEndpoint: "http://127.0.0.1:8000/iroharness/events"
});
```

See [docs/external-bridges.md](./docs/external-bridges.md).

Validate custom adapters before wiring them into a character:

```js
import { assertMicroHarnessContract } from "iroharness/testing";

await assertMicroHarnessContract(adapter, {
  task: fixture.task,
  context: fixture.context
});
```

See [docs/adapter-contract-testing.md](./docs/adapter-contract-testing.md).

Connect a local JSONL worker process:

```js
import { createJsonlProcessMicroHarness } from "iroharness/adapters";

const hermes = createJsonlProcessMicroHarness({
  id: "hermes",
  command: "node",
  args: ["./workers/hermes-bridge.mjs"],
  capabilities: ["learning", "skills"]
});
```

Connect Claude Code as a delegated coding micro harness:

```js
import { createClaudeCodeCliMicroHarness } from "iroharness/adapters";

const claudeCode = createClaudeCodeCliMicroHarness({
  cwd: "/path/to/project",
  args: ["-p"]
});
```

Run the guarded example:

```bash
IROHARNESS_RUN_CLAUDE=1 CLAUDE_WORKSPACE=/path/to/project npm run example:claude -- "Claude Codeで設計レビューして"
```

For Codex app-server delegation:

```bash
IROHARNESS_RUN_CODEX=1 CODEX_WORKSPACE=/path/to/project npm run example:codex -- "CodexでREADMEをレビューして"
```

See [docs/codex.md](./docs/codex.md).

For voice/text/deep model switching:

```bash
npm run example:brains
```

Generated companion apps can also route each brain slot to a model gateway from
`.env`:

```bash
IROHARNESS_VOICE_BRAIN_ENDPOINT=http://127.0.0.1:8788/voice
IROHARNESS_TEXT_BRAIN_ENDPOINT=http://127.0.0.1:8788/text
IROHARNESS_DEEP_BRAIN_ENDPOINT=http://127.0.0.1:8788/deep
IROHARNESS_BRAIN_AUTH_TOKEN=optional-bearer-token
```

See [docs/brains.md](./docs/brains.md).

For realtime voice contracts:

```js
import {
  createJavascriptRealtimeCore,
  createRealtimeLatencyTracker,
  createRealtimeVoiceSession,
  createRustRealtimeCoreBinding,
  createTextStreamingStt,
  createTextStreamingTts
} from "iroharness";
```

See [docs/realtime.md](./docs/realtime.md).

For an external realtime core process:

```bash
npm run example:realtime-core
```

This uses the same runtime core contract that a future Rust or Go fast path can
implement.

## Platform Adapters

Discord and YouTube inputs are normalized before they reach personality,
permissions, or micro harness delegation.

```js
import {
  createDiscordMessageAdapter,
  createSlackMessageAdapter,
  createYouTubeLiveChatAdapter
} from "iroharness/adapters";

const discord = createDiscordMessageAdapter({ mentionOnly: true });
const slack = createSlackMessageAdapter({ mentionOnly: true });
const youtube = createYouTubeLiveChatAdapter();
```

For stream-aware permissions, attach stream context after normalization:

```js
import {
  createSnapshotStreamSessionResolver,
  createStreamContextEnricher
} from "iroharness/adapters";

const enrichTurn = createStreamContextEnricher({
  resolveStreamSession: createSnapshotStreamSessionResolver({
    snapshot: () => userRegistry.snapshot()
  })
});
```

For real YouTube live chat polling:

```bash
YOUTUBE_API_KEY=... YOUTUBE_LIVE_CHAT_ID=... npm run example:youtube
```

For a Discord Gateway bot:

```bash
DISCORD_BOT_TOKEN=... DISCORD_BOT_USER_ID=... npm run example:discord
```

For Slack Events API handling:

```bash
SLACK_BOT_TOKEN=... SLACK_BOT_USER_ID=... npm run example:slack
```

For OBS Browser Source control:

```bash
OBS_WEBSOCKET_URL=ws://127.0.0.1:4455 OBS_OVERLAY_INPUT="IroHarness Overlay" npm run example:obs
```

The dev server also exposes:

```text
POST /platform/discord/message
POST /platform/slack/message
POST /platform/youtube/message
GET  /platforms
```

See [docs/platform-adapters.md](./docs/platform-adapters.md).

## Audience Registry

YouTube, Discord, Slack, VS Code, browser, M5Stack, and Even G2 identities can
all point to the same durable user. Roles and permission overrides decide what
the person can do without changing the character's personality.

```bash
npm run example:audience
```

See [docs/audience-data-model.md](./docs/audience-data-model.md) and
[docs/audience-and-permissions.md](./docs/audience-and-permissions.md).
For OBS/YouTube streaming and Discord fan/community operations, see
[docs/streaming-community.md](./docs/streaming-community.md).

The dev server can also expose local audience management endpoints such as
`GET /audience`, `GET /audience/resolve`, `POST /audience/users`,
`POST /audience/users/:userId/identities`, and
`POST /audience/users/:userId/permissions` when it is created with a
`userRegistry`. This is the setup path for Discord fan communities, YouTube
live streams, OBS operators, and developer-only deep discussion. Add
`adminToken` if the server is reachable outside a trusted local machine.

With the browser demo running, seed stream identities from another shell:

```bash
IROHARNESS_URL=http://127.0.0.1:4178 npm run example:audience-admin
```

## Browser Avatar Demo

Run:

```bash
npm run demo:browser
```

Then open the printed URL. The demo exposes:

- `GET /events` for Server-Sent Events
- `POST /turn` for text/voice-like input
- `GET /state` for current character state
- `GET /pjos` for Project OS state
- `GET /health` for public readiness and optional runtime/error metadata
- `GET /openapi.json` for the local HTTP API contract
- `GET /bodies`, `/body/:id`, and `/body/:id/events` for MotionPNGTuber,
  M5Stack, Even G2, Live2D, and VRM bridge state
- `POST /platform/discord/message` and `/platform/youtube/message` for chat
  platform testing
- `/?view=admin` for local audience, platform identity, permission, and stream
  session management

For the VS Code companion panel:

```bash
code examples/vscode-companion
```

See [docs/vscode.md](./docs/vscode.md).

The browser avatar is intentionally simple: it proves that the same normalized
character state can drive a visual body while PJOS and micro harness delegation
continue to run behind it.

For OBS or YouTube streaming, add overlay mode:

```text
http://127.0.0.1:4178/?view=overlay
```

Overlay mode hides the controls and uses a transparent background for OBS
Browser Source composition.

OBS WebSocket control is available through `createObsWebSocketAdapter`. Approved
macro stream operations can use `createObsStreamController` so `manage_stream`
gates scene, overlay, and mute changes before OBS WebSocket is called. See
[docs/obs.md](./docs/obs.md).

## Core Concepts

### Character Instance

An identity is not only a prompt. In IroHarness, a character instance is:

```text
SOUL + memory + macro harness behavior + tools + body expression + failure modes
```

Different harnesses can be treated as different characters. For example,
`Iroha-Hermes` and `Maguro-Codex` may share a world or team canon, but they are
not automatically the same person.

### Brains

IroHarness separates model choice from identity:

- `voice` brain: low latency, short replies, interruption friendly
- `text` brain: deeper language quality for Slack, Discord, email, web chat
- `deep` brain: developer discussion, strategy, architecture, and planning
- `work` brain or micro harness: coding, research, execution, review

The macro harness can switch engines automatically while keeping character state
consistent.

### Bodies

A body is a device or renderer adapter:

- MotionPNGTuber
- Live2D
- VRM/3D
- M5Stack dot face
- Even G2 display
- browser avatar
- VS Code panel
- Slack/Discord text

All bodies receive the same normalized character state.

Body bridges expose mapped snapshots and SSE streams for renderers and devices.
See [docs/body-bridges.md](./docs/body-bridges.md).

### Project OS

PJOS is the durable state layer between macro decisions and micro execution.
It records goals, stories, specs, tickets, runs, artifacts, and links back to the
character and harness that produced them.

### Audience Registry And Permissions

The same person may appear across YouTube, Discord, Slack, and the browser. The
user registry links those platform IDs to a single user record:

```js
userRegistry.registerUser({
  id: "user_keita",
  displayName: "Keita",
  role: "developer",
  identities: {
    youtube: "UCxxx",
    discord: "123456"
  }
});
```

Role permissions decide whether a user can only chat, have deep architecture
discussion, or delegate work to micro harnesses. The personality stays owned by
the character macro harness.

Stream operations use the same policy. Requests that mention OBS, scene,
overlay, mute, or live stream control are routed as `stream` operations and
require `manage_stream`. Moderators and owners can operate a stream; public fans
cannot.

For long-running deployments, use the PostgreSQL/Supabase schema in
`protocols/sql/postgres-audience.sql`:

```text
iroharness_users
iroharness_user_identities
iroharness_permission_overrides
iroharness_stream_sessions
```

This is the table layer for OBS/YouTube streams, Discord fan chats, and
developer-only work delegation.

Use it from the core with a `pg`-style query function:

```js
import { createPostgresUserRegistry } from "iroharness";

const userRegistry = createPostgresUserRegistry({
  query: (sql, params) => pool.query(sql, params)
});
```

## Why Rust Later

Rust will not make remote LLMs think faster. It can reduce the overhead around
the wait:

- audio stream routing
- VAD and interruption handling
- WebSocket fanout
- device state synchronization
- expression state updates
- low-latency scheduler loops

The recommended path is:

```text
v0: Node.js core to stabilize protocols
v1: adapters for Codex, OpenClaw, Hermes, AIAvatarKit, M5Stack, Live2D
v2: Rust realtime core for audio/device/event bus
```

The Rust core crate starts at `crates/realtime-core`. See
[docs/rust-core.md](./docs/rust-core.md).

## Repository Layout

```text
src/
  index.js              core macro harness, router, PJOS, adapters
  adapters/             built-in adapter helpers
  testing/              contract testing helpers
fixtures/
  golden/               adapter contract fixtures
protocols/
  audience-store.schema.json
  character-state.schema.json
  realtime-core-command.schema.json
  realtime-core-message.schema.json
  sql/
    postgres-audience.sql
  user.schema.json
  adapter-contracts.md
docs/
  adapter-contract-testing.md
  architecture.md
  audience-and-permissions.md
  audience-data-model.md
  brains.md
  body-bridges.md
  build-an-adapter.md
  character-profile.md
  capability-matrix.md
  cli.md
  codex.md
  ci.md
  design-principles.md
  external-bridges.md
  platform-adapters.md
  obs.md
  privacy-and-security.md
  streaming-community.md
  realtime.md
  rust-core.md
  vscode.md
  protocols.md
examples/
  adapter-skeleton.mjs
  audience-registry.mjs
  basic.mjs
  body-mappers.mjs
  brain-switching.mjs
  file-pjos.mjs
  codex-app-server.mjs
  discord-bot.mjs
  slack-events.mjs
  external-bridges.mjs
  youtube-live-poller.mjs
  obs-overlay-control.mjs
  realtime-core-process.mjs
  realtime-core-worker.mjs
  browser-server.mjs
  browser-avatar/
  vscode-companion/
test/
  *.test.js
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md).

## License

MIT
