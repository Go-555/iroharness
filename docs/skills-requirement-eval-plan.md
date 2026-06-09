# Skills `requires` Runtime Evaluation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire `satisfiedRequirements` into `createIroHarness.receive()` so a skill's `requires:` gating condition (a runtime/config/environment flag like `stream.enabled`, per §4.3/§6) is actually evaluated. Today the gate logic exists (`gateSkills`/`isSkillEligible` already accept `satisfiedRequirements`), but `receive()` never passes it, so it defaults to `[]` and **every `requires`-gated skill is fail-closed excluded**.

**Architecture:** `requires` is a separate axis from `capability` — it is NOT about the actor's identity/permissions; it is a config/environment/platform/binary condition the operator knows about. So the operator supplies the satisfied set. `createIroHarness` gains a `satisfiedRequirements` option that is **either a `string[]` (static) or a `(context) => string[]` resolver** (evaluated per turn, so a condition that changes mid-session — e.g. stream toggled off — is reflected). `receive()` resolves it and passes the result to the existing `gateSkills` call. The gate logic in `src/skills/gate.js` is UNCHANGED.

**Fail-closed posture (this is authz-adjacent — it controls which skills are visible):** the default is `[]` (no requirements satisfied → `requires`-gated skills stay excluded, exactly today's behavior). A resolver that **throws** or returns a **non-array** is treated as `[]` (none satisfied → those skills excluded) with a `console.warn`, never crashing the turn and never opening a skill on error.

**Tech Stack:** Node.js ESM, `node --test`, `node:assert/strict`. Files: `src/index.js`, `src/index.d.ts`, tests. Zero new deps. `src/skills/gate.js` is NOT touched.

**Scope:** thread an operator-provided `satisfiedRequirements` (static or resolver) through `receive()` into `gateSkills`, with fail-closed normalization. NO change to the gate logic, no new gating axis.

**Grounding facts (verified against the code):**
- `src/skills/gate.js`: `isSkillEligible({ gating, view, permissions, satisfiedRequirements = [] })` already does `if (gating.requires && !satisfiedRequirements.includes(gating.requires)) return false;`. `gateSkills({ skills, view, permissions, satisfiedRequirements = [] })` already threads it. **No change needed here.**
- `src/index.js` `createIroHarness({ character, projectOs, userRegistry, permissionPolicy, audiencePolicy, brains, microHarnesses = [], skills = null, hooks = null })` — add `satisfiedRequirements = []`.
- In `receive()`, the gate is called (~line 3148, post-#20) as:
  ```js
  const skillListing = skills
    ? createSkillContextListing({
        skills: gateSkills({ skills: skills.list(), view: tierToView(audience.tier), permissions: actorPermissions }),
      })
    : Object.freeze([]);
  ```
  Available context at that point: `input`, `actor`, `route`, `audience`, `state`, `actorPermissions`, `contextScopes`.
- Design doc: §4.3/§6 define `requires` as "config, environment, platform, binary presence" — an absent `requires` always passes; `capability`/`requires` are runtime checks (not export-time). Fixtures use `requires: stream.enabled`.

---

## File Structure
- Modify `src/index.js` — add `satisfiedRequirements` param; a `resolveSatisfiedRequirements(spec, context)` helper (fail-closed); pass the result to `gateSkills`.
- Modify `src/index.d.ts` — type the new option (`string[] | (context) => string[]`).
- Modify `test/runtime-skills.test.js` — requires-gating runtime tests.
- Modify `docs/extension-model.md` §4.5 — note that `satisfiedRequirements` is now wired (static or resolver, fail-closed).

Test command: `node --test test/runtime-skills.test.js` ; full: `npm test`

---

## Task 1: Resolve + pass `satisfiedRequirements` (static array form)

**Files:** `src/index.js`, `test/runtime-skills.test.js`

- [ ] **Step 1: Write failing tests** in `test/runtime-skills.test.js`. Use the file's existing skill-fixture harness (it already builds a registry with a `needs-req` skill gated `requires: stream.enabled` at ~line 139). Two behaviors for the static-array form:

```js
test("a requires-gated skill is excluded when its requirement is not satisfied", async () => {
  // build a harness whose skills include a `requires: stream.enabled` skill, with the
  // session cleared to see trusted skills; do NOT pass satisfiedRequirements.
  // After a turn, the brain's injected skill listing must NOT contain the needs-req skill.
  // (regression guard: this is today's behavior)
});

test("a requires-gated skill is INCLUDED when satisfiedRequirements (static array) lists it", async () => {
  // build the same harness with createIroHarness({ ..., satisfiedRequirements: ["stream.enabled"] }).
  // After a turn, the injected skill listing MUST contain the needs-req skill.
});
```
(Model these on the EXISTING runtime-skills tests — reuse `buildSkills([...])` (frontmatter as a raw string; the `needs-req` / `requires: stream.enabled` fixture already exists at ~line 139), `buildHarness({...})`, `receiveAs(harness, "developer")` (developer → trusted tier, so `requires` is the only remaining gate), and `skillIds(brain)` (reads `brain.captured().skills`).
**Required harness change:** `buildHarness` does NOT currently accept/forward `satisfiedRequirements` — add a `satisfiedRequirements` option to `buildHarness` and thread it into its `createIroHarness({...})` call, OR call `createIroHarness` directly in the new tests. Option (a) keeps the tests DRY.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/runtime-skills.test.js`
Expected: FAIL — the "INCLUDED" test fails because `receive()` never passes `satisfiedRequirements` (the skill is excluded even when it should be eligible).

- [ ] **Step 3: Implement** in `src/index.js`:
  1. Add `satisfiedRequirements = []` to the `createIroHarness({...})` destructure.
  2. Add a module-level (or in-factory) helper:
  ```js
  // requires-gating is authz-adjacent: a resolver that throws or returns a non-array
  // is treated as "none satisfied" (fail-closed — requires-gated skills stay hidden),
  // never crashing the turn and never opening a skill on error.
  const resolveSatisfiedRequirements = (spec, context) => {
    let value;
    try {
      value = typeof spec === "function" ? spec(context) : spec;
    } catch (error) {
      console.warn(`[skills] satisfiedRequirements resolver threw; treating as none satisfied: ${error.message}`);
      return [];
    }
    if (!Array.isArray(value)) {
      if (value != null)
        console.warn(`[skills] satisfiedRequirements must be an array; treating as none satisfied`);
      return [];
    }
    return value;
  };
  ```
  3. In `receive()`, just before the `skillListing` block, compute the satisfied set and pass it to `gateSkills`:
  ```js
  const satisfied = resolveSatisfiedRequirements(satisfiedRequirements, {
    input, actor, route, audience, state, permissions: actorPermissions, contextScopes,
  });
  const skillListing = skills
    ? createSkillContextListing({
        skills: gateSkills({
          skills: skills.list(),
          view: tierToView(audience.tier),
          permissions: actorPermissions,
          satisfiedRequirements: satisfied,
        }),
      })
    : Object.freeze([]);
  ```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/runtime-skills.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/index.js test/runtime-skills.test.js
git commit -m "feat(skills): evaluate requires gating via satisfiedRequirements (static array)"
```

---

## Task 2: Resolver (function) form + fail-closed behavior

**Files:** `src/index.js` (already implemented in Task 1 — this task is tests only), `test/runtime-skills.test.js`

- [ ] **Step 1: Write failing/▶passing tests** (the implementation from Task 1 already covers these; write them and confirm green):

```js
test("satisfiedRequirements may be a resolver — included when the resolver returns the requirement", async () => {
  // createIroHarness({ ..., satisfiedRequirements: (ctx) => ["stream.enabled"] }) -> skill included.
});

test("the resolver receives the turn context (can key off route/state/actor)", async () => {
  // pass a resolver that records its argument; assert it received { input, actor, route, audience, state, permissions, contextScopes }.
});

test("a resolver that throws fails closed (skill excluded, turn still responds)", async () => {
  // satisfiedRequirements: () => { throw new Error("boom"); }
  // -> the turn completes (kind "response"); the needs-req skill is NOT in the listing.
});

test("a resolver that returns a non-array fails closed (skill excluded)", async () => {
  // satisfiedRequirements: () => "stream.enabled"  // a string, not an array
  // -> needs-req skill NOT in the listing (treated as none satisfied).
});
```

- [ ] **Step 2: Run**

Run: `node --test test/runtime-skills.test.js`
Expected: PASS (Task 1's implementation already handles the resolver + fail-closed paths).

- [ ] **Step 3: Commit**
```bash
git add test/runtime-skills.test.js
git commit -m "test(skills): satisfiedRequirements resolver form + fail-closed on throw/non-array"
```

---

## Task 3: Types + docs

**Files:** `src/index.d.ts`, `docs/extension-model.md`

- [ ] **Step 1: Type the option** in `src/index.d.ts`. Read the file first; match its existing style (it defines named `interface`s like `TurnInput`/`ResolvedActor`/`RouteDecision` for complex shapes). Define a named context interface and use it, rather than a bare `Record`:
  ```ts
  export interface SatisfiedRequirementsContext {
    input: TurnInput;
    actor: ResolvedActor;
    route: RouteDecision;
    audience: AudienceContext;
    state: CharacterState;
    permissions: readonly string[];
    contextScopes: readonly string[];
  }
  ```
  then on the `createIroHarness` options:
  ```ts
  satisfiedRequirements?: readonly string[] | ((context: SatisfiedRequirementsContext) => readonly string[]);
  ```
  (Conform to the exact interface names that already exist in the file — if any differ, reuse the real ones; fall back to `Record<string, unknown>` for any field whose type isn't declared.)

- [ ] **Step 2: Doc** — in `docs/extension-model.md` §4.5 (Runtime Integration), add a short note that `requires` is now evaluated at runtime via a `satisfiedRequirements` option (static `string[]` or a per-turn `(context) => string[]` resolver), fail-closed to none-satisfied on a throw/non-array.

- [ ] **Step 3: Full suite + check + commit**
```bash
npm test && npm run check
git add src/index.d.ts docs/extension-model.md docs/skills-requirement-eval-plan.md
git commit -m "feat(skills): type + document satisfiedRequirements; mark requires evaluation done"
```

---

## Done When
- [ ] A `requires:`-gated skill is excluded by default (no `satisfiedRequirements`) and included when the satisfied set (static array OR resolver return) contains its requirement.
- [ ] The resolver is evaluated per turn with the turn context; a throwing or non-array resolver fails closed (skill excluded, turn still responds) with a warning.
- [ ] `src/skills/gate.js` is unchanged; `npm test` + `npm run check` green; `.d.ts` types the option.

## Follow-on (not this plan)
- **C:** protectedKeys nested-key protection (deferred — deep-freeze covers the current actor case).
