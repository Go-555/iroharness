# IroHarness Agent Instructions

IroHarness is a character macro harness. The repository exists to keep
character identity, memory, Project OS, audience permissions, realtime state,
body renderers, and micro-harness delegation under one stable boundary.

## Repository Invariants

- The macro harness owns character identity.
- Models, Codex, Claude Code, OpenClaw, Hermes, local scripts, and provider
  gateways are engines or delegated workers. They are not automatically the
  character.
- Browser, OBS, YouTube, Discord, Slack, VS Code, M5Stack, Even G2, Live2D, VRM,
  MotionPNGTuber, and AIAvatarKit are entry points or bodies for the same
  character.
- Audience identity is resolved through the user registry before permissions,
  relationship, or response depth are inferred.
- Permissions gate deep discussion, work delegation, stream control, and user
  management.
- Long-running work belongs in Project OS state, not only in chat history.
- Realtime fast paths may move to Rust, WASM, native addons, or external
  processes without moving character identity out of the macro harness.

## Development Rules

- Keep the dependency-free public JavaScript contracts easy to inspect.
- Keep adapters replaceable and protocol-shaped.
- Add tests for any public API, protocol, generated app behavior, or permission
  rule change.
- Update README, docs, roadmap, and changelog when changing OSS capabilities.
- Do not commit local secrets, `.env`, generated `.iroharness/*.json`, or
  audience backups.

## Validation

Run the relevant checks before committing:

```bash
npm run verify
npm run package:dry-run
```

When Rust is available, also run:

```bash
cargo test -p iroharness-realtime-core
cargo build -p iroharness-realtime-core --lib
cargo build -p iroharness-realtime-core --lib --target wasm32-unknown-unknown
cargo build -p iroharness-realtime-core --bin iroharness-realtime-core-jsonl
```
