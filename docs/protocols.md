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
