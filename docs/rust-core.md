# Rust Realtime Core

IroHarness starts with a dependency-free Node.js macro harness so the public
contracts can stabilize. The Rust crate is the future low-latency core for
audio, event, and device scheduling.

```text
crates/realtime-core
  RealtimeBus
  AudioChunk
  DeviceCommand
  BargeInGate
  LatencyTracker
```

## Scope

The Rust core should own the fast path:

- audio chunk buffering
- bounded event fanout
- VAD / barge-in state
- low-latency device commands
- latency marks close to the audio loop

The macro harness still owns:

- character identity
- audience registry and permissions
- PJOS
- model and micro-harness routing
- body/device expression policy

## Current Crate

`iroharness-realtime-core` currently defines the contracts and pure Rust state
machines:

- `RealtimeEventKind`
- `RealtimeEvent`
- `AudioChunk`
- `DeviceCommand`
- `RealtimeBus`
- `BargeInGate`
- `LatencyTracker`

It intentionally has no external dependencies yet. That keeps it portable while
the Node.js layer and protocol tests settle.

## Node Binding Contract

Node runtime bindings start in `src/index.js`:

- `createJavascriptRealtimeCore`: dependency-free fallback implementation
- `createRustRealtimeCoreBinding`: optional Rust native/WASM/process binding
- `createRealtimeVoiceSession({ realtimeCore })`: publishes voice events and
  latency marks through the runtime core

The binding expects the native side to expose some or all of this shape:

```js
{
  publish(event) {},
  mark(name, at) {},
  measure(name, startMark, endMark) {},
  startSpeaking() {},
  finishSpeaking() {},
  shouldInterrupt(event) {},
  snapshot() {}
}
```

Missing optional methods degrade gracefully. If no Rust implementation is
available, `createRustRealtimeCoreBinding` can fall back to
`createJavascriptRealtimeCore` so app code does not fork.

## JSONL Process Fast Path

`createJsonlRealtimeCoreProcess` lets the runtime core live in a separate
process before a native addon or WASM module exists. This is the preferred
bridge for early Rust or Go experiments because the macro harness can keep its
stable JavaScript API while the fast path evolves independently.

Run the demo:

```bash
npm run example:realtime-core
```

The process receives newline-delimited JSON operations such as `publish`,
`mark`, `startSpeaking`, and `shouldInterrupt`. It can write JSONL messages back
for diagnostics, telemetry, or lower-level device state.

## Validation

When Rust is installed:

```bash
cargo test -p iroharness-realtime-core
```

This environment may not always have `rustc` installed, so the Node test suite
also includes static checks that the crate and core contracts exist.
