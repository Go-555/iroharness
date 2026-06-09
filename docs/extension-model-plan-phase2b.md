# Extension Model — Phase 2b (Runtime Skill Integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the skill gate into `createIroHarness.receive()` so eligible skills reach the brain, filtered per turn by the actor's tier-derived view and capabilities.

**Architecture:** `createIroHarness` gains an optional `skills` registry. On the brain path of `receive()` (after the audience is resolved, after the `work`/`stream` early returns, immediately before `brain.respond`), it runs `gateSkills` with `view: tierToView(audience.tier)` and `permissions: actorPermissions`, compiles the result with `createSkillContextListing`, and passes it to `brain.respond` as a new `skills` field. View-only `tierToView` maps owner→owner, trusted→trusted, operator→trusted, everything else→public (fail-closed).

**Tech Stack:** Node.js ESM, `node --test`, `node:assert/strict`. Factory pattern in `src/index.js`. `gateSkills`/`createSkillContextListing`/`createFileSkillRegistry` are exported from `src/skills/index.js`.

**Spec:** `docs/extension-model.md` §4.5 (reconciled and independently reviewed).

**Scope:** Phase 2b only — the skill→brain runtime wiring. Hook dispatch wiring (`turn:before` etc.), the throw policy, and `transform`×authz are phase 5 (2a). No `viewZone` param, no requirement evaluator (`requires`-gated skills are excluded fail-closed this phase, per §4.5).

**Grounding facts (verified against the code):**
- `createIroHarness({ character, projectOs, userRegistry, ..., brains, devices, microHarnesses, streamController })` at `src/index.js:2676`. Add `skills = null` to this destructure.
- In `receive()` (`src/index.js:2736`): `actorPermissions` is assigned at ~2760, `audience` (with `audience.tier`) at ~2764. The `work` route returns at ~2781 (`runMicroHarness`), `stream` at ~2785 (`runStreamController`). `brain.respond({ character, input, actor, audience, route, state, projectOs })` is at ~2795. Insert the gating just before that call.
- `audience.tier` is one of `owner`/`trusted`/`operator`/`member`/`public`/`anonymous` (from `tierFor`). `audience.permissions` and `actorPermissions` hold the same values; use `actorPermissions` (already in scope).
- `gateSkills({ skills, view, permissions, satisfiedRequirements })` (omit `satisfiedRequirements` → defaults `[]`). `createSkillContextListing({ skills })` → array of `{ id, name, description, userInvocable, argumentHint }`. `registry.list()` returns skill objects with `metadata.manifestPath`.
- A registered user's role drives the tier: `userRegistry.registerUser({ id, role, identities: { <platform>: "<uid>" } })` then `receive({ ..., actor: { platform, platformUserId } })`. Roles: `owner`→tier owner, `developer`→trusted, `moderator`→operator, `member`→member, `fan`→public; no actor → anonymous.
- `src/index.js` does NOT currently import from `./skills/index.js` — add the import.
- Existing brains receive context via `respond(context)`; adding a `skills` field is non-breaking (brains read only what they destructure).

---

## File Structure

- Modify `src/index.js` — add `skills` param to `createIroHarness`; add internal `tierToView`; import `gateSkills`/`createSkillContextListing` from `./skills/index.js`; insert gating before `brain.respond`; add `skills` to the respond context.
- Modify `src/index.d.ts` — add optional `skills` to the `createIroHarness` options type (light touch).
- Create `test/runtime-skills.test.js` — integration tests via `createIroHarness` + a capturing brain.

Test command (this file): `node --test test/runtime-skills.test.js`
Full suite: `npm test`

**Shared test helpers** (place at the top of `test/runtime-skills.test.js`):

```js
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createFileSkillRegistry,
} from "../src/skills/index.js";
import {
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
} from "../src/index.js";

// A brain that records the context it was called with.
const createCapturingBrain = (id) => {
  let captured = null;
  return {
    id,
    async respond(context) {
      captured = context;
      return { text: "ok", emotion: "focused" };
    },
    captured: () => captured,
  };
};

// Build a skills registry over a temp dir of SKILL.md fixtures.
const buildSkills = (entries) => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-runtime-skills-"));
  for (const [id, frontmatter] of entries) {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(
      join(dir, id, "SKILL.md"),
      `---\nname: ${id}\ndescription: ${id} skill.\n${frontmatter}---\n\n# ${id}\n`,
      "utf8",
    );
  }
  return createFileSkillRegistry({ skillDirs: [dir], builtIns: [] });
};

// Build a harness whose text brain captures context; register one user with a role.
const buildHarness = ({ skills = null, role = null, permissionsFor = null } = {}) => {
  const userRegistry = createInMemoryUserRegistry();
  if (role) {
    userRegistry.registerUser({
      id: role,
      displayName: role,
      role,
      identities: { web: role.toUpperCase() },
    });
  }
  const brain = createCapturingBrain("capture");
  const harness = createIroHarness({
    character: { id: "iroha", name: "Iroha", soul: "x", voiceStyle: "short" },
    projectOs: createInMemoryProjectOs(),
    userRegistry,
    brains: { voice: brain, text: brain },
    skills,
    ...(permissionsFor
      ? { permissionPolicy: { evaluate: () => ({ allowed: true }), permissionsFor } }
      : {}),
  });
  return { harness, brain, role };
};

const receiveAs = (harness, role) =>
  harness.receive({
    source: "web",
    modality: "text",
    text: "hi",
    ...(role ? { actor: { platform: "web", platformUserId: role.toUpperCase() } } : {}),
  });

const skillIds = (brain) => (brain.captured().skills || []).map((s) => s.id).sort();
```

---

## Task 1: `skills` param + tier→view gating wired into `receive`

**Files:**
- Modify: `src/index.js`
- Test: `test/runtime-skills.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("owner sees all skills; a no-skills harness passes an empty listing", async () => {
  const skills = buildSkills([
    ["pub", "view: public\n"],
    ["trust", "view: trusted\n"],
    ["own", "view: owner\n"],
  ]);
  const { harness, brain } = buildHarness({ skills, role: "owner" });
  await receiveAs(harness, "owner");
  assert.deepEqual(skillIds(brain), ["own", "pub", "trust"]); // owner view sees all

  const bare = buildHarness({ role: "owner" }); // no skills registry
  await receiveAs(bare.harness, "owner");
  assert.deepEqual(bare.brain.captured().skills, []); // empty, non-breaking
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runtime-skills.test.js`
Expected: FAIL — `createIroHarness` ignores `skills`; `context.skills` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/index.js`:

1. Add to the import block (near the top, after the other imports) — note this introduces a one-directional import `src/index.js → src/skills/index.js`:

```js
import { gateSkills, createSkillContextListing } from "./skills/index.js";
```

2. Add a module-level helper (near other small helpers, above `createIroHarness`):

```js
const SKILL_TIER_VIEW = Object.freeze({
  owner: "owner",
  trusted: "trusted",
  operator: "trusted",
});

// Map an audience tier to the skill view layer it may see. Fails closed:
// any unrecognized tier (member/public/anonymous/...) resolves to "public".
const tierToView = (tier) => SKILL_TIER_VIEW[tier] || "public";
```

3. Add `skills = null` to the `createIroHarness` destructured options (at `src/index.js:2676`).

4. In `receive()`, immediately before the `const response = await brain.respond({ ... })` call, insert:

```js
    const skillListing = skills
      ? createSkillContextListing({
          skills: gateSkills({
            skills: skills.list(),
            view: tierToView(audience.tier),
            permissions: actorPermissions,
          }),
        })
      : Object.freeze([]);
```

5. Add `skills: skillListing` to the `brain.respond({ ... })` context object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runtime-skills.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.js test/runtime-skills.test.js
git commit -m "feat(runtime): gate skills per turn and pass the listing to the brain"
```

---

## Task 2: Per-tier view filtering (developer/moderator/fan/anonymous)

**Files:**
- Test: `test/runtime-skills.test.js`
- (No new impl — Task 1's wiring already covers this. This task proves the tier→view matrix.)

- [ ] **Step 1: Write the failing/confirming test**

```js
test("tier maps to view: developer/moderator see trusted, fan and anonymous see public only", async () => {
  const entries = [["pub", "view: public\n"], ["trust", "view: trusted\n"], ["own", "view: owner\n"]];

  const dev = buildHarness({ skills: buildSkills(entries), role: "developer" });
  await receiveAs(dev.harness, "developer");
  assert.deepEqual(skillIds(dev.brain), ["pub", "trust"]); // trusted view

  const mod = buildHarness({ skills: buildSkills(entries), role: "moderator" });
  await receiveAs(mod.harness, "moderator");
  assert.deepEqual(skillIds(mod.brain), ["pub", "trust"]); // operator -> trusted

  const fan = buildHarness({ skills: buildSkills(entries), role: "fan" });
  await receiveAs(fan.harness, "fan");
  assert.deepEqual(skillIds(fan.brain), ["pub"]); // public only

  const anon = buildHarness({ skills: buildSkills(entries) }); // no registered actor -> anonymous
  await receiveAs(anon.harness, null);
  assert.deepEqual(skillIds(anon.brain), ["pub"]); // anonymous -> public (fail-closed)
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test test/runtime-skills.test.js`
Expected: PASS (Task 1's `tierToView` already implements this). If `moderator` does not yield `["pub","trust"]`, confirm `tierFor` maps `moderator`→`operator` and `SKILL_TIER_VIEW.operator === "trusted"`.

- [ ] **Step 3: Commit**

```bash
git add test/runtime-skills.test.js
git commit -m "test(runtime): tier->view matrix for skill visibility"
```

---

## Task 3: Capability and `requires` still gate within a view

**Files:**
- Test: `test/runtime-skills.test.js`

Capability composes with view: a trusted skill that also requires the `delegate_work` capability is visible only to an actor that both clears the trusted view AND holds `delegate_work`. `requires`-gated skills are excluded this phase (no `satisfiedRequirements`), per §4.5.

- [ ] **Step 1: Write the failing/confirming test**

```js
test("capability gates within a view; requires-gated skills are excluded this phase", async () => {
  const entries = [
    ["pub", "view: public\n"],
    ["trust-cap", "view: trusted\ncapability: delegate_work\n"],
    ["needs-req", "view: public\nrequires: stream.enabled\n"],
  ];
  // Deterministic permissions: developer holds delegate_work, moderator does not.
  const permissionsFor = (user) =>
    user.role === "developer" ? ["delegate_work"] : [];

  const dev = buildHarness({ skills: buildSkills(entries), role: "developer", permissionsFor });
  await receiveAs(dev.harness, "developer");
  // trusted view + delegate_work -> sees trust-cap; needs-req excluded (no satisfiedRequirements)
  assert.deepEqual(skillIds(dev.brain), ["pub", "trust-cap"]);

  const mod = buildHarness({ skills: buildSkills(entries), role: "moderator", permissionsFor });
  await receiveAs(mod.harness, "moderator");
  // trusted view but lacks delegate_work -> trust-cap excluded by capability
  assert.deepEqual(skillIds(mod.brain), ["pub"]);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test test/runtime-skills.test.js`
Expected: PASS. (Confirms capability composes with view, and `requires` fails closed.)

- [ ] **Step 3: Update the type declaration**

In `src/index.d.ts`, add an optional `skills` field to the `createIroHarness` options interface (a registry handle; type it loosely, e.g. `skills?: { list: () => unknown[] } | null`). Keep consistent with the file's existing style.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: full suite green, no regressions (existing `test/harness.test.js` brains that ignore `context.skills` are unaffected).

- [ ] **Step 5: Commit**

```bash
git add test/runtime-skills.test.js src/index.d.ts
git commit -m "test(runtime): capability composes with view; requires fail-closed; type skills param"
```

---

## Done When

- [ ] `node --test test/runtime-skills.test.js` passes (3 tests).
- [ ] `npm test` passes with no regressions.
- [ ] A harness with a `skills` registry passes the per-actor eligible listing to `brain.respond` as `context.skills`; owner sees all, developer/moderator see trusted, fan/anonymous see public only; capability and `requires` still gate within a view.
- [ ] A harness without `skills` is unchanged (`context.skills` is `[]`); existing brains and tests are unaffected.

## Follow-on (not this plan)

- **2a (phase 5):** wire in-process hook `dispatch` into `receive()` (`turn:before`/`tool:before`/`response:before`) + the §6 throw policy + the `transform`×authz guard.
- **Requirement evaluator:** pass real `satisfiedRequirements` to `gateSkills` (config/env/platform), so `requires`-gated skills can become visible.
- **Command runner / agent runner:** child-process and LLM hook styles.
