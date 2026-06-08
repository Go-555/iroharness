# Extension Model — Phase 2 (Skill Gating) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add zero-trust gating to the existing skills subsystem — filter discoverable skills by view layer and actor capability before they are listed into the macro harness prompt.

**Architecture:** A single new file `src/skills/gate.js` reads three flat frontmatter keys (`view`, `capability`, `requires`) from each skill's `SKILL.md` via the **exported** `parseSkillFrontmatter` + the manifest's `metadata.manifestPath`, then filters the existing registry's skill list. It touches no upstream-private code (`skillManifestFromFrontmatter`/`normalizeSkillManifest` stay untouched). The eligible set is passed to the existing `createSkillContextListing` unchanged. Pure logic (parse + eligibility) is separated from the one IO wrapper so most tests need no disk.

**Tech Stack:** Node.js ESM, Node built-in test runner (`node --test`), `node:assert/strict`. Factory/helper pattern returning `Object.freeze(...)`, matching `src/skills/index.js`.

**Spec:** `docs/extension-model.md` §4 (Skills), §5 (module boundaries), §8.2 (phasing). Reconciled against the real `src/skills/` and independently reviewed.

**Scope:** Phase 2 = the runtime gate only (spec §8.2). The zero-trust **view-export** integration (§4.4 / §8.3) and the hook command/agent runners (§8.4–8.5) are separate follow-on plans.

**Grounding facts (verified against the codebase):**
- `parseSkillFrontmatter(markdown)` is exported from `src/skills/index.js` and returns `{ frontmatter, body }` where `frontmatter` is a frozen object of flat keys.
- A registry skill carries `skill.metadata.manifestPath` (the absolute path to its `SKILL.md`).
- View order is `public` < `trusted` < `owner` (mirrors `bin/iroharness.mjs`).
- The actor's held capabilities are the `permissions` string array from `createAudienceContextPolicy().resolve(...)` (e.g. `["deep_discussion","delegate_work"]`), tested by membership.
- `createSkillContextListing({ skills })` is a passive formatter that accepts a pre-filtered list.

**Working branch:** `feat/extension-skills-phase2` (stacked on `feat/extension-model`; rebase onto `main` after PR #10 merges).

---

## File Structure

- Create `src/skills/gate.js` — `VIEW_RANK`, `parseSkillGating`, `isSkillEligible`, `readSkillGating`, `gateSkills`. One responsibility: skill eligibility by view/capability/requires.
- Modify `src/skills/index.js` — re-export the gate's public functions at the end of the file.
- Create `test/skills-gate.test.js` — all Phase 2 tests.
- Create fixtures `test/fixtures/skills-gate/<id>/SKILL.md` — used by the gateSkills IO test.

Test command (single file): `node --test test/skills-gate.test.js`
Full suite: `npm test`

---

## Task 1: `parseSkillGating` — extract gating keys with safe defaults

**Files:**
- Create: `src/skills/gate.js`
- Test: `test/skills-gate.test.js`

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";

import { parseSkillGating } from "../src/skills/gate.js";

test("parseSkillGating reads the three flat keys", () => {
  const g = parseSkillGating({ view: "trusted", capability: "delegate_work", requires: "stream.enabled" });
  assert.equal(g.view, "trusted");
  assert.equal(g.capability, "delegate_work");
  assert.equal(g.requires, "stream.enabled");
});

test("parseSkillGating defaults: view=public, capability/requires=null", () => {
  const g = parseSkillGating({});
  assert.equal(g.view, "public");
  assert.equal(g.capability, null);
  assert.equal(g.requires, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skills-gate.test.js`
Expected: FAIL — cannot find module `../src/skills/gate.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/skills/gate.js
const VIEW_RANK = Object.freeze({ public: 0, trusted: 1, owner: 2 });

export const parseSkillGating = (frontmatter = {}) =>
  Object.freeze({
    view: typeof frontmatter.view === "string" ? frontmatter.view : "public",
    capability: typeof frontmatter.capability === "string" ? frontmatter.capability : null,
    requires: typeof frontmatter.requires === "string" ? frontmatter.requires : null
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/skills-gate.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/skills/gate.js test/skills-gate.test.js
git commit -m "feat(skills): parse view/capability/requires gating keys"
```

---

## Task 2: `isSkillEligible` — view-layer check

**Files:**
- Modify: `src/skills/gate.js`
- Test: `test/skills-gate.test.js`

View semantics: a skill's `view` is the **minimum** layer that may see it. A session at view V sees a skill iff `rank(V) >= rank(skill.view)`. So a `public` session sees only `public` skills; an `owner` session sees everything.

- [ ] **Step 1: Write the failing test**

```js
import { parseSkillGating, isSkillEligible } from "../src/skills/gate.js";

test("view gating: session must rank >= skill view", () => {
  const trustedSkill = parseSkillGating({ view: "trusted" });
  const publicSkill = parseSkillGating({ view: "public" });

  // public session
  assert.equal(isSkillEligible({ gating: publicSkill, view: "public" }), true);
  assert.equal(isSkillEligible({ gating: trustedSkill, view: "public" }), false);

  // trusted session
  assert.equal(isSkillEligible({ gating: trustedSkill, view: "trusted" }), true);

  // owner session sees everything
  assert.equal(isSkillEligible({ gating: trustedSkill, view: "owner" }), true);
});

test("isSkillEligible rejects an unknown view layer", () => {
  assert.equal(isSkillEligible({ gating: parseSkillGating({}), view: "nonsense" }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skills-gate.test.js`
Expected: FAIL — `isSkillEligible` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/skills/gate.js`:

```js
export const isSkillEligible = ({ gating, view = "public", permissions = [], satisfiedRequirements = [] }) => {
  const sessionRank = VIEW_RANK[view];
  const skillRank = VIEW_RANK[gating.view];
  if (sessionRank === undefined || skillRank === undefined) return false;
  return sessionRank >= skillRank;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/skills-gate.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/skills/gate.js test/skills-gate.test.js
git commit -m "feat(skills): view-layer eligibility check"
```

---

## Task 3: `isSkillEligible` — capability and requires checks

**Files:**
- Modify: `src/skills/gate.js`
- Test: `test/skills-gate.test.js`

Capability semantics: capability gating is a **membership** test against the actor's `permissions` (non-linear model — no ordered rank). An absent `capability` imposes no restriction. Same for `requires` against `satisfiedRequirements`.

- [ ] **Step 1: Write the failing test**

```js
test("capability gating: actor must hold the named capability", () => {
  const g = parseSkillGating({ capability: "delegate_work" });
  assert.equal(isSkillEligible({ gating: g, view: "owner", permissions: ["delegate_work"] }), true);
  assert.equal(isSkillEligible({ gating: g, view: "owner", permissions: ["manage_stream"] }), false);
  assert.equal(isSkillEligible({ gating: g, view: "owner", permissions: [] }), false);
});

test("requires gating: requirement must be satisfied", () => {
  const g = parseSkillGating({ requires: "stream.enabled" });
  assert.equal(isSkillEligible({ gating: g, view: "owner", satisfiedRequirements: ["stream.enabled"] }), true);
  assert.equal(isSkillEligible({ gating: g, view: "owner", satisfiedRequirements: [] }), false);
});

test("absent capability/requires impose no restriction", () => {
  const g = parseSkillGating({ view: "public" });
  assert.equal(isSkillEligible({ gating: g, view: "public", permissions: [], satisfiedRequirements: [] }), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skills-gate.test.js`
Expected: FAIL — capability/requires not yet enforced.

- [ ] **Step 3: Write minimal implementation**

In `isSkillEligible`, replace the final `return` with:

```js
  if (sessionRank < skillRank) return false;
  if (gating.capability && !permissions.includes(gating.capability)) return false;
  if (gating.requires && !satisfiedRequirements.includes(gating.requires)) return false;
  return true;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/skills-gate.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/skills/gate.js test/skills-gate.test.js
git commit -m "feat(skills): capability and requires eligibility checks"
```

---

## Task 4: `readSkillGating` + `gateSkills` — read frontmatter and filter

**Files:**
- Modify: `src/skills/gate.js`
- Create: `test/fixtures/skills-gate/public-hello/SKILL.md`, `test/fixtures/skills-gate/trusted-secret/SKILL.md`, `test/fixtures/skills-gate/broken/SKILL.md`
- Test: `test/skills-gate.test.js`

`readSkillGating` reads the gating keys from a skill's `SKILL.md` via the exported `parseSkillFrontmatter` and `skill.metadata.manifestPath`. `gateSkills` filters a registry skill list. Per spec §6, a skill whose `SKILL.md` is malformed (parse error) is **excluded** from the eligible set with a logged warning, never throwing — so `gateSkills` wraps each skill's check in try/catch. Note: `gate.js` imports `parseSkillFrontmatter` from `./index.js`; this is a cyclic import but is only used inside `readSkillGating` at call time, so the live binding resolves correctly (the integration test below confirms it).

- [ ] **Step 1: Create the fixtures**

`test/fixtures/skills-gate/public-hello/SKILL.md`:

```markdown
---
name: public-hello
description: A public greeting skill.
---

# Public Hello
Say hello to everyone.
```

`test/fixtures/skills-gate/trusted-secret/SKILL.md`:

```markdown
---
name: trusted-secret
description: A trusted-only skill.
view: trusted
capability: delegate_work
---

# Trusted Secret
Only trusted operators with delegate_work see this.
```

`test/fixtures/skills-gate/broken/SKILL.md` (unclosed frontmatter — parse error):

```markdown
---
name: broken
description: Malformed — the frontmatter block is never closed.

# Broken
This file has no closing frontmatter delimiter.
```

- [ ] **Step 2: Write the failing test**

```js
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { gateSkills, readSkillGating } from "../src/skills/gate.js";
import { createSkillContextListing } from "../src/skills/index.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "skills-gate");
const skillStub = (id) => ({
  id,
  name: id,
  metadata: { manifestPath: join(fixtureDir, id, "SKILL.md") }
});

test("readSkillGating reads gating keys from a SKILL.md", () => {
  const g = readSkillGating(skillStub("trusted-secret"));
  assert.equal(g.view, "trusted");
  assert.equal(g.capability, "delegate_work");
});

test("gateSkills filters by view + capability, and the listing reflects it", () => {
  const skills = [skillStub("public-hello"), skillStub("trusted-secret")];

  // public session: only the public skill survives
  const publicEligible = gateSkills({ skills, view: "public", permissions: [] });
  assert.deepEqual(publicEligible.map((s) => s.id), ["public-hello"]);

  // owner session with delegate_work: both survive
  const ownerEligible = gateSkills({ skills, view: "owner", permissions: ["delegate_work"] });
  assert.deepEqual(ownerEligible.map((s) => s.id).sort(), ["public-hello", "trusted-secret"]);

  // the existing listing accepts the pre-filtered set unchanged
  const listing = createSkillContextListing({ skills: publicEligible });
  assert.deepEqual(listing.map((s) => s.id), ["public-hello"]);
});

test("gateSkills excludes a malformed skill without throwing (spec §6)", () => {
  const skills = [skillStub("public-hello"), skillStub("broken")];
  let eligible;
  assert.doesNotThrow(() => {
    eligible = gateSkills({ skills, view: "owner", permissions: [] });
  });
  assert.deepEqual(eligible.map((s) => s.id), ["public-hello"]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/skills-gate.test.js`
Expected: FAIL — `gateSkills`/`readSkillGating` not exported.

- [ ] **Step 4: Write minimal implementation**

Add to `src/skills/gate.js`:

```js
import { readFileSync } from "node:fs";

import { parseSkillFrontmatter } from "./index.js";

export const readSkillGating = (skill) => {
  const manifestPath = skill?.metadata?.manifestPath;
  if (!manifestPath) {
    throw new Error(`skill manifestPath is required: ${skill?.id || "(missing)"}`);
  }
  const { frontmatter } = parseSkillFrontmatter(readFileSync(manifestPath, "utf8"));
  return parseSkillGating(frontmatter);
};

export const gateSkills = ({ skills, view = "public", permissions = [], satisfiedRequirements = [] }) =>
  Object.freeze(
    skills.filter((skill) => {
      let gating;
      try {
        gating = readSkillGating(skill);
      } catch (error) {
        // Spec §6: a malformed SKILL.md is skipped with a warning, never aborts.
        console.warn(`[skills] skipping unreadable skill ${skill?.id || "(unknown)"}: ${error.message}`);
        return false;
      }
      return isSkillEligible({ gating, view, permissions, satisfiedRequirements });
    })
  );
```

Put the `import` lines at the top of the file (above `VIEW_RANK`).

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/skills-gate.test.js`
Expected: PASS (10 tests — includes the malformed-skill exclusion).

- [ ] **Step 6: Commit**

```bash
git add src/skills/gate.js test/skills-gate.test.js test/fixtures/skills-gate
git commit -m "feat(skills): gateSkills reads frontmatter and filters by eligibility"
```

---

## Task 5: Export wiring + full suite

**Files:**
- Modify: `src/skills/index.js` (re-export at end of file)
- Test: `test/skills-gate.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("the ./skills entry exposes the gate", async () => {
  const mod = await import("iroharness/skills");
  assert.equal(typeof mod.gateSkills, "function");
  assert.equal(typeof mod.isSkillEligible, "function");
  assert.equal(typeof mod.parseSkillGating, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skills-gate.test.js`
Expected: FAIL — `gateSkills` is not exported from `iroharness/skills`.

- [ ] **Step 3: Write minimal implementation**

Append to the end of `src/skills/index.js`:

```js
export { parseSkillGating, isSkillEligible, readSkillGating, gateSkills } from "./gate.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/skills-gate.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: all existing tests plus `test/skills-gate.test.js` pass. (If a cyclic-import error appears here, it means `parseSkillFrontmatter` is referenced before initialization — move the gate re-export to the very bottom of `index.js`, after `parseSkillFrontmatter` is defined, which it already is.)

- [ ] **Step 6: Commit**

```bash
git add src/skills/index.js test/skills-gate.test.js
git commit -m "feat(skills): expose skill gating from ./skills entry"
```

---

## Done When

- [ ] `node --test test/skills-gate.test.js` passes (11 tests).
- [ ] `npm test` passes with no regressions.
- [ ] `src/skills/gate.js` exists; `iroharness/skills` exposes `gateSkills`, `isSkillEligible`, `parseSkillGating`, `readSkillGating`.
- [ ] No upstream-private code (`skillManifestFromFrontmatter`, `normalizeSkillManifest`) was modified.

## Follow-on Plans (not this plan)

- **Phase 3 (spec §8.3):** zero-trust view-export integration — `iroharness view export --zone <z>` materializes only view-visible skills. Wires the gate's view check into the existing export in `bin/iroharness.mjs`.
- **Session integration (later):** call `gateSkills` at session start with the resolved audience `permissions` + the session view, caching the eligible set once, then feed `createSkillContextListing`. Kept out of Phase 2 so the gate lands as an isolated, fully-tested unit.
- **Hook runners (spec §8.4–8.5):** command + agent runners for the text-path hook gates.
