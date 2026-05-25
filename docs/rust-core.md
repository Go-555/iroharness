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

## Validation

When Rust is installed:

```bash
cargo test -p iroharness-realtime-core
```

This environment may not always have `rustc` installed, so the Node test suite
also includes static checks that the crate and core contracts exist.
