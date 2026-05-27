# CI

IroHarness has two required validation lanes.

## Node

The Node lane validates the dependency-free macro harness, platform adapters,
examples, and packaging surface.

```bash
npm install
npm run verify
npm run package:dry-run
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

## Release

The `Release` workflow publishes the npm package with provenance. It runs the
same Node and Rust gates as CI before publishing.

Triggers:

- GitHub Release published
- manual `workflow_dispatch`

Manual runs default to `dry_run=true`, which executes
`npm publish --dry-run --provenance --access public`. Set `dry_run=false` only
when the version, changelog, and release notes are ready.

Required secret:

```text
NPM_TOKEN
```
