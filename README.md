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

## Status

This repository is an early OSS skeleton. It intentionally starts with a small
dependency-free Node.js core so the protocols can stabilize before a Rust
realtime core is introduced.

## Install

```bash
npm install
```

There are no runtime dependencies today.

## Quick Start

```bash
npm run example
npm run example:bodies
npm run example:pjos
```

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

### Project OS

PJOS is the durable state layer between macro decisions and micro execution.
It records goals, stories, specs, tickets, runs, artifacts, and links back to the
character and harness that produced them.

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

## Repository Layout

```text
src/
  index.js              core macro harness, router, PJOS, adapters
  adapters/             built-in adapter helpers
protocols/
  character-state.schema.json
  adapter-contracts.md
docs/
  architecture.md
examples/
  basic.mjs
  body-mappers.mjs
  file-pjos.mjs
test/
  *.test.js
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md).

## License

MIT
