# Build An Adapter

Adapters are the main extension point for IroHarness. They should translate an
external system into an IroHarness contract without taking over character
identity.

Use this rule first:

```text
macro harness owns identity, permissions, Project OS, and relationship
adapter owns transport, translation, and provider-specific errors
```

## Choose The Boundary

| Adapter Type | Use When | Contract |
|---|---|---|
| Micro harness | A worker can execute coding, research, review, automation, or skills | `id`, `capabilities`, `run(task, context)` |
| Body/device | A renderer or device should show character state, speech, or work progress | `id`, `kind`, `capabilities`, `emit(event)` |
| Brain/model | A response engine should produce immediate speech/text | `id`, `respond(context)` |
| Platform input | A chat or app payload should become an IroHarness turn | `normalize(payload)` or runtime wrapper |
| Runtime | A service loop receives events and calls `harness.receive()` | `start()`, `stop()`, `state()` |

If the integration changes who the character is, the boundary is wrong. Put
personality in `SOUL.md`, memory, or macro harness configuration instead.

## Micro Harness Adapter

Use a micro harness when the external system performs work. The adapter receives
a PJOS task and macro context, then returns a final work result.

```js
export const createExampleMicroHarness = ({ endpoint, fetchImpl = fetch }) =>
  Object.freeze({
    id: "example-worker",
    capabilities: Object.freeze(["code", "review"]),
    async run(task, context) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          context,
          boundary: "IroHarness owns identity; this worker executes only."
        })
      });
      const data = await response.json();
      return Object.freeze({
        status: data.status || "completed",
        summary: data.summary || "Worker completed the task.",
        artifacts: Object.freeze(data.artifacts || []),
        raw: data
      });
    }
  });
```

Contract test:

```js
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { assertMicroHarnessContract } from "iroharness/testing";

import { createExampleMicroHarness } from "./example-adapter.js";

const fixture = JSON.parse(
  readFileSync(join("fixtures", "golden", "micro-task.json"), "utf8")
);

test("example micro harness follows IroHarness contract", async () => {
  const adapter = createExampleMicroHarness({
    endpoint: "http://example.invalid/run",
    fetchImpl: async () => ({
      async json() {
        return {
          status: "completed",
          summary: "ok",
          artifacts: []
        };
      }
    })
  });

  await assertMicroHarnessContract(adapter, fixture);
});
```

## Body Or Device Adapter

Use a body adapter when an external renderer should receive normalized character
events.

```js
export const createExampleBodyDevice = ({ send }) =>
  Object.freeze({
    id: "example-body",
    kind: "body",
    capabilities: Object.freeze(["state", "speech", "task"]),
    async emit(event) {
      if (event.type === "state") {
        await send({ mode: event.state.mode, emotion: event.state.emotion });
      }
      if (event.type === "speech") {
        await send({ speechText: event.text });
      }
      if (event.type === "task") {
        await send({ task: event.taskRef, status: event.status });
      }
    }
  });
```

Contract test:

```js
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { assertDeviceContract } from "iroharness/testing";

import { createExampleBodyDevice } from "./example-body.js";

const fixture = JSON.parse(
  readFileSync(join("fixtures", "golden", "body-events.json"), "utf8")
);

test("example body follows IroHarness contract", async () => {
  const sent = [];
  await assertDeviceContract(createExampleBodyDevice({ send: (value) => sent.push(value) }), {
    events: fixture.events
  });
});
```

## Brain Adapter

Use a brain adapter when a model should produce immediate text or speech. The
brain can inspect character, actor, audience, route, and input context, but it
does not become the character.

```js
export const createExampleBrain = ({ generate }) =>
  Object.freeze({
    id: "example-brain",
    async respond(context) {
      const output = await generate({
        character: context.character,
        audience: context.audience,
        input: context.input
      });
      return Object.freeze({
        text: output.text,
        emotion: output.emotion || "attentive"
      });
    }
  });
```

Contract test:

```js
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { assertBrainContract } from "iroharness/testing";

import { createExampleBrain } from "./example-brain.js";

const fixture = JSON.parse(
  readFileSync(join("fixtures", "golden", "brain-context.json"), "utf8")
);

test("example brain follows IroHarness contract", async () => {
  await assertBrainContract(
    createExampleBrain({
      generate: async ({ character }) => ({
        text: `Hello from ${character.name}.`
      })
    }),
    fixture
  );
});
```

## Platform Adapter

Platform adapters normalize incoming payloads into turns:

```js
{
  source: "discord",
  modality: "text",
  text: "こんにちは",
  actor: {
    platform: "discord",
    platformUserId: "123456",
    displayName: "Fan One"
  },
  metadata: {}
}
```

Then the macro harness resolves the actor through the user registry and checks
permissions. Do not embed role decisions or character prompts in the platform
adapter.

## Pull Request Checklist

- Add the adapter to the appropriate entrypoint if it should be public.
- Add or update TypeScript declarations.
- Add a contract test with golden fixtures or a deterministic fake transport.
- Add documentation that states which credentials and permissions are required.
- Keep private prompts, tokens, user data, and character memory out of fixtures.
- Run:

```bash
npm run verify
npm run package:dry-run
```

If the adapter touches the realtime core, also run:

```bash
cargo test -p iroharness-realtime-core
cargo build -p iroharness-realtime-core --bin iroharness-realtime-core-jsonl
```
