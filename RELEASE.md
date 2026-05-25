# Release

IroHarness publishes the Node package and includes the Rust realtime core source
inside the npm tarball.

## Local Checklist

```bash
npm install
npm run verify
npm run package:dry-run
```

If Rust is installed:

```bash
cargo test -p iroharness-realtime-core
cargo build -p iroharness-realtime-core --bin iroharness-realtime-core-jsonl
```

## Publish

1. Update `CHANGELOG.md`.
2. Update `package.json` version.
3. Run the local checklist.
4. Confirm GitHub Actions is green on `main`.
5. Publish with npm provenance when available:

```bash
npm publish --provenance
```

## Post-Release

- Create a Git tag matching the npm version.
- Confirm `npx iroharness init ./my-companion --character Iroha` works from the
  published package.
