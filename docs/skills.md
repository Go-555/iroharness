# Skills

IroHarness skills are reusable workflow or reference units. They are not meant
to replace deterministic tooling. Use a skill to describe when and how a runner
should use tools, CLIs, APIs, micro harnesses, and evaluators.

## Design Rules

- Split reference-only skills from workflow skills.
- Describe each skill with Purpose, Trigger, Shape, and Role.
- Keep the entry file short; put detailed specs in referenced files.
- Put deterministic checks in CLI/API code instead of prose.
- Separate generation from evaluation.
- Evaluators must not change their own evaluation criteria.
- Workflows that produce files must state the expected artifact paths and done
  criteria.

## CLI

List available skills:

```bash
iroharness skill list ./my-companion
```

Create a StackChan avatar-pack plan from one reference image:

```bash
iroharness skill plan stackchan-avatar-pack ./my-companion \
  --reference-image ./reference.png \
  --pack-id iroha-black-ribbon
```

Validate a generated avatar pack:

```bash
iroharness skill eval stackchan-avatar-pack ./my-companion \
  --pack-dir ./.iroharness/artifacts/avatar-packs/iroha-black-ribbon
```

## Built-in StackChan Avatar Pack Skill

The first built-in workflow is `run-stackchan-avatar-pack`. It creates a plan
for turning one reference image into the 8-file StackChan avatar pack:

- `neutral.png`
- `neutral_blink.png`
- `joy.png`
- `fun.png`
- `angry.png`
- `sorrow.png`
- `mouth_half.png`
- `mouth_open.png`

The first six are full-face `320x240` PNGs. The last two are transparent
mouth-only overlays used for lipsync.

The deterministic evaluator checks required file names, PNG dimensions, and
alpha presence for the mouth overlays. Visual quality still requires a human or
image-capable evaluator to review the contact sheet before provisioning.
