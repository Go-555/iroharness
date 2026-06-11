# Brains And Model Switching

IroHarness keeps identity in the macro harness and treats models as replaceable
brains.

```text
same character
  + voice brain -> low latency, short responses
  + text brain  -> ordinary chat, architecture, strategy, deep discussion
  + work brain  -> delegated micro harness such as Codex
```

## Provider SSOT

Brain, STT, and TTS provider configuration belongs on the host side, not inside
interfaces or device firmware.

IroHarness owns the SSOT for:

- voice/text/work route selection
- LLM provider endpoints and model names
- STT provider endpoints and credentials
- TTS provider endpoints, voices, and credentials
- Codex OAuth usage through `codex app-server`
- routing policy that chooses a slot for each turn

Slack, StackChan, browser avatars, Live2D, VRM, OBS, and other interfaces should
send normalized turns into IroHarness. They should not each define their own
LLM/STT/TTS API keys or model routing. For StackChan specifically, firmware can
own microphone and speaker settings, but STT, LLM, and TTS providers stay behind
the trusted device gateway.

## Routing Order

The default heuristic router uses this priority:

```text
work signal -> micro harness
voice input -> voice brain
other text  -> text brain
```

This means a spoken phrase like "設計について話そう" still uses the low-latency
voice brain, while a typed architecture discussion uses the text brain selected
for high-quality conversation.

## HTTP Brain

Use `createHttpBrain` to connect a model service while preserving the same
IroHarness context:

```js
import { createHttpBrain } from "iroharness";

const text = createHttpBrain({
  id: "text-main",
  endpoint: "http://127.0.0.1:8788/respond",
  model: "text-model"
});
```

The endpoint receives:

```json
{
  "model": "text-model",
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

## Codex OAuth Brain

Use `createCodexAppServerBrain` when you want a voice or text brain to use the
host machine's Codex OAuth session instead of an API key. The host must already
be logged in with `codex login`.

```js
import { createCodexAppServerBrain } from "iroharness/adapters";

const voice = createCodexAppServerBrain({
  id: "voice-codex-gpt-5.5",
  slot: "voice",
  cwd: "/path/to/project",
  model: "gpt-5.5"
});
```

This follows the same separation that OpenClaw uses for model routing: auth is
handled as a provider credential/profile concern, while the active model is a
separate selection. In IroHarness, Codex OAuth belongs to the local
`codex app-server` process; IroHarness selects the brain slot and model.
That host-level OAuth session must not be exposed through public gateways or
copied into exported views.

For a main character brain, including the StackChan voice route, default to
read-only sandboxing and no approvals:

```text
approvalPolicy: "never"
threadSandbox: "read-only"
```

Coding, file editing, and reviews should still go through a micro harness such
as `createCodexAppServerMicroHarness`, where `delegate_work` permission and
approval policy can be stricter.

## Example

```bash
npm run example:brains
npm run example:brain-gateway
npm run example:provider-brain-gateway
```

`example:brains` shows voice/text routing without changing character
identity. `example:brain-gateway` starts a local HTTP brain gateway on
`127.0.0.1:8788` with `/voice` and `/text` routes.
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
IROHARNESS_TEXT_BRAIN_MODEL=high-quality-text-model
```

The Slack + Codex companion can use Codex OAuth directly for the text brain:

```bash
codex login

IROHARNESS_TEXT_BRAIN_PROVIDER=codex
IROHARNESS_TEXT_BRAIN_MODEL=gpt-5.5
npm run example:slack-codex
```

The important invariant is that each brain receives the same macro context:
character profile, actor, audience permissions, route, current state, and PJOS.
Only the engine changes. Because each engine also brings its own default
personality, run `iroharness persona-check` before and after swapping a slot's
model to regression-test the character (see [persona-guard.md](./persona-guard.md)).

The gateway endpoint is intentionally thin. In production, keep this protocol
shape and replace the demo response logic with calls to your preferred voice or
text model.

## Provider Gateway Recipe

The provider gateway keeps IroHarness' HTTP brain contract stable while changing
only the model provider behind each slot.

```bash
PORT=8789 \
IROHARNESS_VOICE_BRAIN_PROVIDER=openai-compatible \
IROHARNESS_VOICE_BRAIN_MODEL=gpt-oss:20b \
IROHARNESS_TEXT_BRAIN_PROVIDER=openai \
IROHARNESS_TEXT_BRAIN_MODEL="$OPENAI_TEXT_MODEL" \
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

IROHARNESS_VOICE_BRAIN_MODEL=gpt-oss:20b
IROHARNESS_TEXT_BRAIN_MODEL="$OPENAI_TEXT_MODEL"
```

Use this pattern to keep voice fast and cheap while text can use the strongest
conversation model, preserving the same character identity, audience
permissions, and PJOS context.
