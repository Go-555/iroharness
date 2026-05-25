# External Bridges

IroHarness should absorb useful ideas from OpenClaw, Hermes, and AIAvatarKit
without becoming any one of them.

## Boundary

```text
IroHarness
  owns: character identity, audience registry, PJOS, routing, permissions

OpenClaw / Hermes / Codex / Claude Code
  own: specialized execution, tools, native sessions, worker memory

AIAvatarKit / Live2D / MotionPNGTuber / M5Stack / Even G2
  own: body rendering, audio pipeline, device expression
```

This keeps the same character stable while allowing engines and bodies to be
swapped.

## OpenClaw

Use `createOpenClawMicroHarness` when an OpenClaw instance should execute a
prepared task from IroHarness.

```js
import { createOpenClawMicroHarness } from "iroharness/adapters";

const openclaw = createOpenClawMicroHarness({
  endpoint: "http://127.0.0.1:8787/agent/run",
  apiKey: process.env.OPENCLAW_API_KEY,
  agentId: "iroha-openclaw"
});
```

The bridge sends:

```json
{
  "message": "task purpose",
  "agentId": "iroha-openclaw",
  "sessionId": "optional session id",
  "source": "iroharness",
  "task": {},
  "context": {
    "character": {},
    "actor": {},
    "projectOs": {}
  }
}
```

OpenClaw can return `summary`, `reply`, `message`, `result.summary`, or
`result.reply`. IroHarness normalizes those into a micro-harness output.

## Hermes

Use `createHermesGatewayMicroHarness` when Hermes should handle learning,
skills, or messaging work through a local gateway endpoint.

```js
import { createHermesGatewayMicroHarness } from "iroharness/adapters";

const hermes = createHermesGatewayMicroHarness({
  endpoint: "http://127.0.0.1:8765/message",
  conversationId: "iroha-hermes"
});
```

The bridge sends task text plus macro metadata, then accepts `summary`, `text`,
`reply`, or `message` in the response.

## Claude Code

Use `createClaudeCodeCliMicroHarness` when Claude Code should execute a local
development task while IroHarness keeps ownership of identity, permissions, and
PJOS.

```js
import { createClaudeCodeCliMicroHarness } from "iroharness/adapters";

const claudeCode = createClaudeCodeCliMicroHarness({
  cwd: "/path/to/project",
  command: "claude",
  args: ["-p"]
});
```

The adapter writes an IroHarness prompt to stdin. The prompt includes the task,
character, actor, and PJOS context, and explicitly frames Claude Code as a
delegated micro harness rather than the character itself.

Claude Code can return plain text. If the final stdout line is JSON with
`status`, `summary`, and `artifacts`, IroHarness will normalize that structured
result.

```bash
IROHARNESS_RUN_CLAUDE=1 CLAUDE_WORKSPACE=/path/to/project npm run example:claude -- "Claude Codeで実装方針をレビューして"
```

## AIAvatarKit

AIAvatarKit is treated as a body/speech bridge, not as the owner of Iroha's
identity.

```js
import { createAIAvatarKitBridgeDevice } from "iroharness/adapters";

const avatar = createAIAvatarKitBridgeDevice({
  eventEndpoint: "http://127.0.0.1:8000/iroharness/events",
  stateEndpoint: "http://127.0.0.1:8000/iroharness/state",
  speechEndpoint: "http://127.0.0.1:8000/iroharness/speech"
});
```

The device receives IroHarness `state`, `speech`, and `task` events and POSTs a
small JSON envelope to the configured endpoints. A thin FastAPI route in an
AIAvatarKit app can translate those events into MotionPNGTuber, WebSocket, SSE,
or voice behavior.

## Design Rule

If an external system is doing work, model it as a micro harness. If it is
showing or speaking the character, model it as a body. The macro harness remains
the source of truth for personality, permissions, and PJOS state.
