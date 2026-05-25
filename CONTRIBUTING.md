# Contributing

IroHarness is built around stable contracts before broad feature work.

Good first contributions:

- a new body adapter
- a micro-harness adapter
- a Project OS exporter
- examples that show character state changing across bodies
- tests for routing and task/run state

Design rules:

- keep identity in the macro harness, not inside a single provider adapter
- keep body/rendering adapters replaceable
- keep micro harnesses as delegated workers
- every long-running work item should create or update PJOS state
- prefer streaming interfaces for voice and expression work

Before opening a PR:

```bash
npm run verify
npm run package:dry-run
```

If Rust is installed:

```bash
cargo test -p iroharness-realtime-core
cargo build -p iroharness-realtime-core --bin iroharness-realtime-core-jsonl
```

Please open issues or discussions for protocol changes before large patches.
