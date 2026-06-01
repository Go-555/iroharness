---
name: run-stackchan-avatar-pack
description: Use when creating a StackChan avatar pack from one reference image.
kind: workflow
purpose: produce
shape: orchestrated
role: generator
user-invocable: true
argument-hint: "<reference image> [--pack-id id]"
inputs:
  - referenceImage
  - packId
  - characterName
  - direction
outputs:
  - avatar-pack-plan
  - avatar-pack
references:
  - skills/run-stackchan-avatar-pack/references/stackchan-avatar-spec.md
evaluator: eval-stackchan-avatar-pack
---

# StackChan Avatar Pack

Create a reviewed 8-file StackChan avatar pack from one reference image.

## Contract

- Treat this as a workflow skill, not a dictionary skill.
- Keep generation and evaluation separate.
- Do not provision or upload to a device until the user approves the contact sheet.
- Use the deterministic evaluator before copying files into firmware data.
- Preserve character direction; do not reproduce a real person's identity from a reference photo.

## Workflow

1. Create a plan:

```bash
iroharness skill plan stackchan-avatar-pack <app-dir> --reference-image <image-path> --pack-id <pack-id>
```

2. Generate a neutral base face and get user approval.
3. Generate full-face expressions: `neutral_blink`, `joy`, `fun`, `angry`, `sorrow`.
4. Create mouth-only transparent overlays: `mouth_half`, `mouth_open`.
5. Build a contact sheet for review.
6. Evaluate the artifact:

```bash
iroharness skill eval stackchan-avatar-pack <app-dir> --pack-dir <pack-dir>
```

7. After approval, copy files into `firmware/stackchan-runtime/examples/basic/data/avatar/` and run `uploadfs`.

## Files

Read `references/stackchan-avatar-spec.md` for the exact file contract.
