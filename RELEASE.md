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
5. Create a GitHub Release for the version tag, or run the `Release` workflow
   manually with `dry_run=false`.

The release workflow runs Node checks, Rust checks, package dry-run, and
publishes with npm provenance. Configure `NPM_TOKEN` as a GitHub Actions secret
before publishing.

Manual fallback:

```bash
npm publish --provenance
```

## Post-Release

- Confirm the Git tag matches the npm version.
- Confirm `npx iroharness init ./my-companion --character Iroha` works from the
  published package.
