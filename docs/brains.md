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
npm run example:provider-brain-gateway
```

`example:brains` shows voice/text/deep routing without changing character
identity. `example:brain-gateway` starts a local HTTP brain gateway on
`127.0.0.1:8788` with `/voice`, `/text`, and `/deep` routes.
`example:provider-brain-gateway` starts the same contract on `127.0.0.1:8789`,
but routes each slot to OpenAI Responses, Anthropic Messages, or a local
OpenAI-compatible chat completions server.

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

## Provider Gateway Recipe

The provider gateway keeps IroHarness' HTTP brain contract stable while changing
only the model provider behind each slot.

```bash
PORT=8789 \
IROHARNESS_VOICE_BRAIN_PROVIDER=openai-compatible \
IROHARNESS_VOICE_BRAIN_MODEL=gpt-oss:20b \
IROHARNESS_TEXT_BRAIN_PROVIDER=openai \
IROHARNESS_TEXT_BRAIN_MODEL="$OPENAI_TEXT_MODEL" \
IROHARNESS_DEEP_BRAIN_PROVIDER=anthropic \
IROHARNESS_DEEP_BRAIN_MODEL="$ANTHROPIC_DEEP_MODEL" \
OPENAI_API_KEY="$OPENAI_API_KEY" \
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
npm run example:provider-brain-gateway
```

Supported providers:

| Provider | API shape | Env |
|---|---|---|
| `openai` | `POST /v1/responses` | `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` |
| `anthropic` | `POST /v1/messages` | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_BASE_URL` |
| `openai-compatible` | `POST /v1/chat/completions` | optional `LOCAL_OPENAI_BASE_URL`, `LOCAL_OPENAI_API_KEY` |

Slot-specific variables override shared defaults:

```bash
IROHARNESS_VOICE_BRAIN_PROVIDER=openai-compatible
IROHARNESS_TEXT_BRAIN_PROVIDER=openai
IROHARNESS_DEEP_BRAIN_PROVIDER=anthropic

IROHARNESS_VOICE_BRAIN_MODEL=gpt-oss:20b
IROHARNESS_TEXT_BRAIN_MODEL="$OPENAI_TEXT_MODEL"
IROHARNESS_DEEP_BRAIN_MODEL="$ANTHROPIC_DEEP_MODEL"
IROHARNESS_DEEP_BRAIN_MAX_TOKENS=1200
```

Use this pattern to keep voice fast and cheap, text balanced, and deep
discussion on a stronger model while preserving the same character identity,
audience permissions, and PJOS context.
