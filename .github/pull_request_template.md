## Summary

Describe what changed and why.

## Boundary Checklist

- [ ] Character identity remains owned by the macro harness.
- [ ] Platform/body adapters stay replaceable and do not own personality.
- [ ] Micro harnesses remain delegated workers, not implicit character owners.
- [ ] Permissions are checked before work delegation or stream control.
- [ ] Project OS state is created or updated for long-running work.

## Validation

Paste the commands you ran:

```bash
npm run verify
npm run package:dry-run
```

If this touches Rust realtime core code, also run:

```bash
cargo test -p iroharness-realtime-core
```

## Notes

Mention any compatibility concerns, protocol changes, or follow-up work.
