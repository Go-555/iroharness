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

## Brain Adapter

Brain adapters produce immediate character responses.

Required fields:

- `id`
- `respond(context)`

The macro harness owns identity. Brain adapters are engines, not characters.
