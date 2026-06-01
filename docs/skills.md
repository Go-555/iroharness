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

The recommended frontmatter shape is:

```yaml
---
name: assign-stackchan-avatar-evaluator
description: Use when evaluating StackChan avatar packs.
purpose: judge
trigger: internal
shape: forked
role: evaluator
context: fork
user-invocable: false
allowed-tools:
  - Read
pair: run-stackchan-avatar-pack
---
```

The four IroHarness design axes are metadata contracts:

- `purpose`: what the skill returns (`knowledge`, `produce`, `judge`,
  `pass-through`)
- `trigger`: who should invoke it (`user`, `internal`, `both`)
- `shape`: how it runs (`atomic`, `forked`, `orchestrated`)
- `role`: its orchestration role (`generator`, `evaluator`, `contributor`,
  `delegate`, `dictionary`)

## CLI

IroHarness looks for user-managed skills in `~/.iroharness/skills/` by
default. Each skill can live in its own directory:

```text
~/.iroharness/skills/
└── run-stackchan-avatar-pack/
    ├── SKILL.md
    └── references/
```

Generated apps may also carry app-local skills under
`.iroharness/skills/<skill-id>/SKILL.md`. Built-in package skills are shipped
in the repository-level `skills/` directory. `SKILL.md` frontmatter is the
canonical manifest; `skill.json` is not part of the IroHarness skill format.

## Progressive Disclosure

IroHarness follows the same three-stage loading shape as Claude Code skills:

1. **Listing context**: `name` and `description` from frontmatter are always
   available so the runner can decide when a skill is relevant.
2. **Invocation context**: after a skill is selected, the `SKILL.md` body is
   loaded as the workflow or reference instructions.
3. **Bundled resources**: files under the skill directory, such as
   `references/`, `scripts/`, and `assets/`, are loaded or executed only when
   the `SKILL.md` body says they are needed.

`disable-model-invocation: true` removes a skill from listing context.
`user-invocable: false` hides it from direct user invocation while still
allowing internal orchestration. `context: fork` marks work that should run in a
separate context and return only a compact result to the parent.

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
