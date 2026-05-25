# Adapter Contracts

IroHarness adapters are intentionally small and language-neutral.

## Device Adapter

Device adapters render character state.

Required fields:

- `id`
- `kind`
- `capabilities`
- `emit(event)`

Events:

- `state`: normalized character state
- `speech`: text or audio output
- `task`: task progress update

## Micro Harness Adapter

Micro harness adapters execute specialized work.

Required fields:

- `id`
- `capabilities`
- `run(task, context)`

`run` may return a final result or an async iterable in future streaming versions.

Minimum final output:

- `status`: `completed`, `failed`, `needs_attention`, or `running`
- `summary`: human-readable summary
- `artifacts`: array of output references

## Brain Adapter

Brain adapters produce immediate character responses.

Required fields:

- `id`
- `respond(context)`

The macro harness owns identity. Brain adapters are engines, not characters.

## Contract Tests

Use `iroharness/testing` with the JSON fixtures in `fixtures/golden/` to validate
adapters:

```js
import { assertMicroHarnessContract } from "iroharness/testing";

await assertMicroHarnessContract(adapter, {
  task,
  context
});
```

The fixtures are language-neutral and can be reused by adapter implementations
outside this repository.
