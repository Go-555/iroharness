# CI

IroHarness has two required validation lanes and one browser screenshot lane.

## Node

The Node lane validates the dependency-free macro harness, platform adapters,
examples, and packaging surface.

```bash
npm install
npm run verify
npm run package:dry-run
```

## Rust

The Rust lane validates the realtime core crate, native/WASM C ABI library, and
the JSONL process binary that can be used as a process-isolated fast path.

```bash
cargo test -p iroharness-realtime-core
cargo build -p iroharness-realtime-core --lib
cargo build -p iroharness-realtime-core --lib --target wasm32-unknown-unknown
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

## Browser Screenshots

The `Browser E2E` workflow captures the browser companion, OBS overlay, and
audience admin views with Playwright. It runs on manual dispatch and on pull
requests that touch browser-facing files.

Local run:

```bash
npm install --no-save playwright
npx playwright install chromium
npm run e2e:browser-screenshots
```

By default, the script starts `examples/browser-server.mjs` on port `4179` and
writes screenshots to:

```text
agent-output/browser-e2e/
```

To point it at an already running companion:

```bash
IROHARNESS_E2E_URL=http://127.0.0.1:4178 npm run e2e:browser-screenshots
```

The check verifies that:

- the chat view renders the avatar and composer
- the OBS overlay view renders the avatar while hiding controls
- the admin view renders audience management controls
- each screenshot is non-empty and written as an artifact
