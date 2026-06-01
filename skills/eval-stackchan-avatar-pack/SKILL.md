---
name: eval-stackchan-avatar-pack
description: Use when reviewing a StackChan avatar pack artifact.
kind: workflow
purpose: judge
shape: forked
role: evaluator
user-invocable: false
context: fork
allowed-tools:
  - Read
inputs:
  - packDir
outputs:
  - validation-report
references:
  - skills/run-stackchan-avatar-pack/references/stackchan-avatar-spec.md
pair: run-stackchan-avatar-pack
---

# StackChan Avatar Pack Evaluator

Validate a generated StackChan avatar pack without changing the generation
criteria. The deterministic CLI evaluator checks required file names, PNG
dimensions, and alpha presence for mouth overlays.

```bash
iroharness skill eval stackchan-avatar-pack <app-dir> --pack-dir <pack-dir>
```
