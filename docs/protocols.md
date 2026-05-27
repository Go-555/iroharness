# Protocols

## Character State

Character state is the shared language between the macro harness and all bodies.

```json
{
  "characterId": "iroha",
  "mode": "speaking",
  "emotion": "focused",
  "speechText": "見てみるね。",
  "taskRef": "ticket_abc123",
  "mouth": "talking",
  "gaze": "user",
  "motion": "working"
}
```

## Device Adapter

A device adapter renders state or sends output to a body.

```js
{
  id: "m5stack",
  kind: "body",
  capabilities: ["display", "speaker", "buttons"],
  emit(event) {
    // event.type: "state" | "speech" | "task"
  }
}
```

## Actor Identity

Incoming messages can include an actor. This lets Discord, YouTube, Slack, and
browser identities map to the same person.

```json
{
  "source": "discord",
  "modality": "text",
  "text": "こんにちは",
  "actor": {
    "platform": "discord",
    "platformUserId": "123456",
    "displayName": "Fan One"
  }
}
```

The macro harness resolves the actor through the user registry before routing.
That means permissions and relationship can change while the character identity
remains stable.

Resolved turns also produce an `audience` context:

```json
{
  "role": "developer",
  "relationship": "core-developer",
  "tier": "trusted",
  "responseDepth": "deep",
  "permissions": ["chat_public", "deep_discussion", "delegate_work"],
  "canDeepDiscuss": true,
  "canDelegateWork": true,
  "canManageStream": false,
  "identityStable": true
}
```

Brains, stream controllers, and micro harnesses receive this context. Platform
adapters do not create it; they only provide the actor identity needed for the
macro harness to resolve it.

## Audience Store

The registry persists audience identity as four collections:

```json
{
  "users": [],
  "userIdentities": [],
  "permissionOverrides": [],
  "streamSessions": []
}
```

Use `userIdentities` to link YouTube, Discord, Slack, VS Code, browser, M5Stack,
Even G2, and future device identities to one person. Use `permissionOverrides`
for narrow or temporary powers such as stream operation. Use `streamSessions` to
keep live chat state separate from the character identity.

See `protocols/audience-store.schema.json`.

## Platform Message Endpoint

The dev server exposes platform-normalized webhook endpoints:

```text
GET  /openapi.json
GET  /health
POST /platform/discord/message
POST /platform/slack/message
POST /platform/youtube/message
GET  /platforms
```

`/openapi.json` returns the OpenAPI 3.1 contract stored at
`protocols/openapi.json`.
`/health` returns public readiness metadata: current character id/mode, body
bridges, platform adapters, optional runtime states, Project OS counts, and
whether audience admin routes are token-protected. It does not expose audience
records. Generated apps also attach runtime telemetry such as `lastReadyAt`,
`lastResultAt`, `lastErrorAt`, and `lastError` for YouTube and Discord runtimes.

Platform adapters convert each payload into the same IroHarness turn shape. From
there, user registry lookup and permission policy are identical.

## Discord Gateway Runtime

`createDiscordBotRuntime` connects to Discord Gateway, identifies with a bot
token, maintains heartbeat, listens for `MESSAGE_CREATE`, normalizes the message
through the Discord adapter, forwards the turn to `harness.receive`, then replies
through Discord's Create Message REST endpoint when a response is available.

The runtime owns Discord transport only. The macro harness still owns
personality, permissions, PJOS, and micro-harness delegation.

## YouTube Polling Runtime

`createYouTubeLiveChatPollingRuntime` calls YouTube Data API
`liveChat/messages`, normalizes each item through the YouTube adapter, skips
duplicate message IDs, and forwards each turn to `harness.receive`.

The runtime owns API polling only. The macro harness still owns personality,
permissions, PJOS, and micro-harness delegation.

## Event Stream Device

The built-in dev server streams events as Server-Sent Events.

```text
event: state
data: {"type":"state","state":{"mode":"speaking"}}

event: speech
data: {"type":"speech","text":"見てみるね。"}

event: task
data: {"type":"task","status":"started","ticketId":"ticket_abc123"}
```

## Body Bridge Endpoints

When body devices are registered with the dev server, renderers and hardware
relays can read mapped body state:

```text
GET /bodies
GET /body/:id
GET /body/:id/events
```

`/body/motionpngtuber` returns payloads such as:

```json
{
  "payload": {
    "stateKey": "mouth_on_eye_on",
    "asset": "mouth_on_eye_on.png",
    "mode": "speaking",
    "emotion": "attentive",
    "speechText": "こんにちは"
  }
}
```

## Brain Adapter

A brain adapter produces character speech. It may be a fast voice model, a deep
text model, or a local rule engine.

```js
{
  id: "voice-fast",
  async respond(context) {
    return {
      text: "うん、見てみるね。",
      emotion: "focused"
    };
  }
}
```

## Micro Harness Adapter

A micro harness is a delegated worker, often a different character or runtime.

```js
{
  id: "codex",
  capabilities: ["code", "files", "review"],
  async run(task, context) {
    return {
      status: "completed",
      summary: "Implemented requested change.",
      artifacts: []
    };
  }
}
```

## PJOS Ticket

```json
{
  "id": "ticket_abc123",
  "title": "Implement Codex adapter",
  "purpose": "Connect IroHarness to a coding micro harness",
  "acceptance": ["Can send a task", "Can stream status", "Can store artifacts"],
  "ownerCharacterId": "iroha",
  "executorHarnessId": "codex",
  "status": "open"
}
```

## HTTP Micro Harness Bridge

The built-in HTTP adapter sends:

```json
{
  "task": {
    "id": "ticket_abc123",
    "title": "Implement adapter",
    "purpose": "Connect to Codex"
  },
  "context": {
    "character": {
      "id": "iroha",
      "name": "Iroha"
    },
    "projectOs": {
      "tickets": [],
      "runs": [],
      "artifacts": []
    }
  }
}
```

The bridge should return:

```json
{
  "status": "completed",
  "summary": "Implemented the adapter.",
  "artifacts": [
    {
      "kind": "file",
      "uri": "file:///repo/src/adapter.js",
      "title": "adapter.js"
    }
  ]
}
```

## JSONL Process Micro Harness Bridge

The process adapter writes one JSON line to stdin and reads the final JSON line
from stdout. This is useful for local wrappers around Codex CLI, Hermes Agent,
OpenClaw tools, or custom workers.

## JSONL Realtime Core Process

External realtime cores read one newline-delimited JSON command per operation:

```json
{
  "op": "mark",
  "coreId": "realtime-core",
  "sequence": 1,
  "timestamp": "2026-05-25T00:00:00.000Z",
  "mark": {
    "name": "audio.received",
    "at": 1000
  }
}
```

The operation set is intentionally small: `publish`, `mark`, `measure`,
`startSpeaking`, `finishSpeaking`, and `shouldInterrupt`. The external process
may write JSONL telemetry back to stdout. IroHarness records those messages in
the core snapshot, but the macro harness keeps identity, permissions, and PJOS
ownership.

Schemas:

- [`protocols/realtime-core-command.schema.json`](../protocols/realtime-core-command.schema.json)
- [`protocols/realtime-core-message.schema.json`](../protocols/realtime-core-message.schema.json)

Golden fixtures:

- [`fixtures/golden/realtime-core-command.json`](../fixtures/golden/realtime-core-command.json)
- [`fixtures/golden/realtime-core-message.json`](../fixtures/golden/realtime-core-message.json)

## Named External Bridges

OpenClaw and Hermes wrappers are small projections of the same micro-harness
contract:

```js
createOpenClawMicroHarness({ endpoint, agentId, sessionId })
createHermesGatewayMicroHarness({ endpoint, conversationId })
```

AIAvatarKit is a body bridge instead:

```js
createAIAvatarKitBridgeDevice({
  eventEndpoint,
  stateEndpoint,
  speechEndpoint
})
```

The named bridges are intentionally thin. They normalize IroHarness task,
character, actor, and PJOS context into shapes that local bridge servers can
adapt to each upstream runtime.
