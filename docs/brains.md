# Brains And Model Switching

IroHarness keeps identity in the macro harness and treats models as replaceable
brains.

```text
same character
  + voice brain -> low latency, short responses
  + text brain  -> ordinary chat
  + deep brain  -> architecture, strategy, deep discussion
  + work brain  -> delegated micro harness such as Codex
```

## Routing Order

The default heuristic router uses this priority:

```text
work signal -> micro harness
voice input -> voice brain
deep text   -> deep brain
other text  -> text brain
```

This means a spoken phrase like "設計について話そう" still uses the low-latency
voice brain, while a typed architecture discussion can use a deeper model.

## HTTP Brain

Use `createHttpBrain` to connect a model service while preserving the same
IroHarness context:

```js
import { createHttpBrain } from "iroharness";

const deep = createHttpBrain({
  id: "text-deep",
  endpoint: "http://127.0.0.1:8788/respond",
  model: "deep-model"
});
```

The endpoint receives:

```json
{
  "model": "deep-model",
  "character": {},
  "actor": {},
  "audience": {},
  "input": {},
  "route": {},
  "state": {},
  "projectOs": {}
}
```

`audience` is the normalized relationship and permission context for the
current turn. It is where a brain can see whether the same character should use
brief voice mode, ordinary public chat, or developer-level deep discussion.

It should return:

```json
{
  "text": "response text",
  "emotion": "focused"
}
```

## Example

```bash
npm run example:brains
npm run example:brain-gateway
```

`example:brains` shows voice/text/deep routing without changing character
identity. `example:brain-gateway` starts a local HTTP brain gateway on
`127.0.0.1:8788` with `/voice`, `/text`, and `/deep` routes.

## Generated App Environment

`iroharness init` creates a companion app that defaults to local echo brains.
Set these variables in `.env` to replace each slot with an HTTP model gateway:

```bash
IROHARNESS_BRAIN_AUTH_TOKEN=
IROHARNESS_VOICE_BRAIN_ENDPOINT=http://127.0.0.1:8788/voice
IROHARNESS_VOICE_BRAIN_MODEL=fast-voice-model
IROHARNESS_TEXT_BRAIN_ENDPOINT=http://127.0.0.1:8788/text
IROHARNESS_TEXT_BRAIN_MODEL=balanced-text-model
IROHARNESS_DEEP_BRAIN_ENDPOINT=http://127.0.0.1:8788/deep
IROHARNESS_DEEP_BRAIN_MODEL=deep-reasoning-model
```

The important invariant is that each brain receives the same macro context:
character profile, actor, audience permissions, route, current state, and PJOS.
Only the engine changes.

The gateway endpoint is intentionally thin. In production, keep this protocol
shape and replace the demo response logic with calls to your preferred voice,
text, or deep reasoning model.
