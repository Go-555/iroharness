# CI

IroHarness has two required validation lanes.

## Node

The Node lane validates the dependency-free macro harness, platform adapters,
examples, and packaging surface.

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

## Rust

The Rust lane validates the realtime core crate and the JSONL process binary
that can be used as the first fast path before native or WASM bindings exist.

```bash
cargo test -p iroharness-realtime-core
cargo build -p iroharness-realtime-core --bin iroharness-realtime-core-jsonl
```

If Rust is not installed locally, the Node tests still statically verify that
the Rust crate, contracts, and binary target exist. GitHub Actions should remain
the authoritative Rust build gate.
