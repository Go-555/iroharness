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

## Platform Message Endpoint

The dev server exposes platform-normalized webhook endpoints:

```text
POST /platform/discord/message
POST /platform/youtube/message
GET  /platforms
```

Platform adapters convert each payload into the same IroHarness turn shape. From
there, user registry lookup and permission policy are identical.

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
