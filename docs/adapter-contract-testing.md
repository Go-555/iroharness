# Adapter Contract Testing

IroHarness adapters should be easy for external contributors to validate before
they are wired into a character.

The `iroharness/testing` entrypoint exports small contract checks:

```js
import {
  assertMicroHarnessContract,
  assertDeviceContract,
  assertBrainContract
} from "iroharness/testing";
```

## Golden Fixtures

Golden fixtures live in `fixtures/golden/`:

- `micro-task.json`: a canonical PJOS task plus macro context
- `body-events.json`: representative state, speech, and task events
- `brain-context.json`: a character/actor/input context for response engines

These fixtures are intentionally plain JSON so other languages can reuse them.

## Micro Harness Contract

```js
const result = await assertMicroHarnessContract(adapter, {
  task: fixture.task,
  context: fixture.context
});
```

The check verifies:

- `id` is a non-empty string
- `capabilities` is an array
- `run(task, context)` exists
- the output has `status`, `summary`, and an artifact array
- `status` is one of `completed`, `failed`, `needs_attention`, or `running`

## Device Contract

```js
await assertDeviceContract(device, {
  events: bodyFixture.events
});
```

The check verifies the adapter can receive normalized state, speech, and task
events without throwing.

## Brain Contract

```js
await assertBrainContract(brain, {
  context: brainFixture.context
});
```

The check verifies a response engine returns text and optional emotion while the
macro harness remains the owner of character identity.

## Repository Test

Run all built-in contract tests:

```bash
npm test
```

Use these tests as the minimum bar for OpenClaw, Hermes, Codex, Claude Code,
AIAvatarKit, Live2D, M5Stack, Even G2, or future adapters.
