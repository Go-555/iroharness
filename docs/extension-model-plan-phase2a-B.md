# Extension Model — Phase 2a-B (turn:before wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the hardened hook `dispatch` into `createIroHarness.receive()` at `turn:before`, so an in-process hook can block a turn (→ reject) or rewrite the input (→ transform), with the actor protected from forgery.

**Architecture:** `createIroHarness` gains an optional `hooks` registry. In `receive()`, after the audience is resolved and before `permissionPolicy.evaluate`, it runs `hooks.dispatch("turn:before", { input, actor, audience, route }, { protectedKeys: ["actor"] })`: a `block` returns a new `rejectByHook` denial; otherwise `input` is reassigned from the (possibly transformed) result. `dispatch` also gains a no-handler hot-path that skips the clone when an event has no hooks.

**Tech Stack:** Node.js ESM, `node --test`, `node:assert/strict`. `createHookRegistry` is exported from `src/extension/hook-registry.js`.

**Spec:** `docs/extension-model.md` §3.7 (reconciled and independently reviewed).

**Scope:** `turn:before` only. `tool:before`/`response:before` are 2a-B-ii. No command/agent runner.

**Grounding facts (verified against the code):**
- `createIroHarness({ ..., skills = null })` destructure (src/index.js ~2951); add `hooks = null,` after `skills = null,`.
- `receive(input)` — `input` is a plain (reassignable) parameter. Order: actor (~3018) → `route` chosen (~3028) → `audience` resolved (~3042-3048) → `permissionPolicy.evaluate` (~3050). Insert the `turn:before` block between the end of audience resolution (~3048) and `const permission = permissionPolicy.evaluate(...)` (~3050).
- `rejectByPermission(input, route, actor, permission, audience)` returns `freezeCopy({ kind: "permission_denied", route, actor, audience, permission, text })` and does setState(speaking)→emit("speech")→setState(idle). `rejectByHook` mirrors this shape with `kind: "hook_denied"`.
- `MODES`, `nowIso`, `freezeCopy`, `emit`, `setState` are in scope in `createIroHarness`.
- `dispatch(event, context, { protectedKeys = [] })` (src/extension/hook-registry.js) deep-freezes the context and drops protected keys from a transform (§6). It has a `passthrough(ctx)` helper (~line 88) and computes `current = freezeContext(context)` (~96) before the handler loop `for (const entry of handlers.get(event) || [])` (~105).

---

## File Structure

- Modify `src/index.js` — add `hooks = null` param; add `rejectByHook` helper (near `rejectByPermission`); insert the `turn:before` dispatch + input reassignment in `receive()`.
- Modify `src/extension/hook-registry.js` — add the no-handler early-return to `dispatch`.
- Create `test/runtime-hooks.test.js` — integration tests via `createIroHarness` + a capturing brain + a hook registry.

Test command (this file): `node --test test/runtime-hooks.test.js`
Full suite: `npm test`

**Shared test helpers** (top of `test/runtime-hooks.test.js`):

```js
import assert from "node:assert/strict";
import test from "node:test";

import { createHookRegistry } from "../src/extension/hook-registry.js";
import {
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
} from "../src/index.js";

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

const buildHarness = ({ hooks = null } = {}) => {
  const brain = createCapturingBrain("capture");
  const harness = createIroHarness({
    character: { id: "iroha", name: "Iroha", soul: "x", voiceStyle: "short" },
    projectOs: createInMemoryProjectOs(),
    userRegistry: createInMemoryUserRegistry(),
    brains: { voice: brain, text: brain },
    hooks,
  });
  return { harness, brain };
};

const sayHi = (harness, text = "hi") =>
  harness.receive({ source: "web", modality: "text", text });
```

---

## Task 1: `hooks` param + `turn:before` block → `rejectByHook`

**Files:**
- Modify: `src/index.js`
- Test: `test/runtime-hooks.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("a turn:before block hook denies the turn before the brain runs", async () => {
  const hooks = createHookRegistry();
  hooks.register("turn:before", () => ({ block: { reason: "nope" } }));
  const { harness, brain } = buildHarness({ hooks });

  const result = await sayHi(harness);

  assert.equal(result.kind, "hook_denied");
  assert.equal(result.reason, "nope");
  assert.equal(brain.captured(), null); // brain never ran
});

test("a harness without hooks behaves exactly as before", async () => {
  const { harness, brain } = buildHarness(); // no hooks
  const result = await sayHi(harness);
  assert.equal(result.kind, "response");
  assert.ok(brain.captured()); // brain ran
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runtime-hooks.test.js`
Expected: FAIL — `hooks` is ignored; the block hook does not deny.

- [ ] **Step 3: Write minimal implementation**

In `src/index.js`:

1. Add `hooks = null,` to the `createIroHarness` destructure, right after `skills = null,`.

2. Add a `rejectByHook` helper next to `rejectByPermission` (mirror its setState/emit pattern):

```js
  const rejectByHook = (input, route, actor, audience, reason) => {
    const text = "そのお願いは今は受けられないよ。";
    setState({
      mode: MODES.speaking,
      emotion: "careful",
      speechText: text,
      mouth: "talking",
      motion: MODES.speaking,
    });
    emit({
      type: "speech",
      text,
      modality: input.modality,
      brainId: "hook-policy",
      timestamp: nowIso(),
    });
    setState({
      mode: MODES.idle,
      emotion: "careful",
      speechText: null,
      mouth: "closed",
      motion: MODES.idle,
    });
    return freezeCopy({
      kind: "hook_denied",
      route,
      actor,
      audience,
      reason: reason ?? null,
      text,
    });
  };
```

3. In `receive()`, immediately after the `audience` is resolved (the `const audience = audiencePolicy.resolve({ ... });` block) and before `const permission = permissionPolicy.evaluate({ ... });`, insert:

```js
    if (hooks) {
      const turnResult = hooks.dispatch(
        "turn:before",
        { input, actor, audience, route },
        { protectedKeys: ["actor"] },
      );
      if (turnResult.blocked) {
        return rejectByHook(input, route, actor, audience, turnResult.reason);
      }
      input = turnResult.context.input ?? input;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runtime-hooks.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.js test/runtime-hooks.test.js
git commit -m "feat(runtime): run turn:before hooks; block denies the turn"
```

---

## Task 2: `turn:before` transform rewrites `input`; `actor` is protected

**Files:**
- Test: `test/runtime-hooks.test.js`
- (No new impl — Task 1's wiring already applies the transform and passes `protectedKeys: ["actor"]`. This task proves both.)

- [ ] **Step 1: Write the failing/confirming test**

```js
test("a turn:before transform rewrites the input the brain receives", async () => {
  const hooks = createHookRegistry();
  hooks.register("turn:before", (ctx) => ({
    transform: { input: { ...ctx.input, text: "REWRITTEN" } },
  }));
  const { harness, brain } = buildHarness({ hooks });

  await sayHi(harness, "original");

  assert.equal(brain.captured().input.text, "REWRITTEN");
});

test("a turn:before hook cannot forge the actor (protectedKeys)", async () => {
  const hooks = createHookRegistry();
  hooks.register("turn:before", () => ({
    transform: { actor: { user: { role: "owner" } } },
  }));
  const { harness, brain } = buildHarness({ hooks });

  await sayHi(harness);

  // actor was passed under protectedKeys: ["actor"], so the forged value is dropped.
  assert.notEqual(brain.captured().actor.user.role, "owner");
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test test/runtime-hooks.test.js`
Expected: PASS. (If the transform test fails, confirm `input = turnResult.context.input ?? input` runs before `brain.respond`. If the actor test fails, confirm `protectedKeys: ["actor"]` is passed to `dispatch`.)

- [ ] **Step 3: Commit**

```bash
git add test/runtime-hooks.test.js
git commit -m "test(runtime): turn:before transform rewrites input; actor is protected"
```

---

## Task 3: dispatch no-handler hot-path + full suite

**Files:**
- Modify: `src/extension/hook-registry.js`
- Test: `test/extension.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/extension.test.js`:

```js
test("dispatch with no handlers does not clone the context (hot path)", () => {
  const registry = createHookRegistry();
  // A non-cloneable context would throw inside structuredClone; with no handlers
  // the clone must be skipped entirely, so this passes through cleanly.
  const result = registry.dispatch("turn:before", { fn: () => {} });
  assert.equal(result.blocked, false);
  assert.equal(typeof result.context.fn, "function"); // passed through, not cloned
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/extension.test.js`
Expected: FAIL — `freezeContext` runs unconditionally and `structuredClone({ fn })` throws a DataCloneError, which (on the gate event `turn:before`) is currently caught and turned into a fail-closed block, so `result.blocked` is `true`, not `false`.

- [ ] **Step 3: Write minimal implementation**

In `src/extension/hook-registry.js` `dispatch`, **before** `let current = freezeContext(context);`, add an early-return for the no-handler case (reuse the `entries` so the loop below uses the same list):

```js
    const entries = handlers.get(event) || [];
    if (entries.length === 0) {
      return passthrough(freezeCopy(context));
    }
```

Then change the loop header from:

```js
    for (const entry of handlers.get(event) || []) {
```

to:

```js
    for (const entry of entries) {
```

(Place the `entries`/early-return after the `mode`/`passthrough`/`failClosed` helper definitions and **before the `let current;` declaration** — i.e. before the `try { current = freezeContext(context); } catch {...}` block, so the clone is skipped entirely when there are no handlers.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/extension.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: full suite green, no regressions (existing `dispatch` tests — passthrough, block, transform, throw-policy, protectedKeys, deep-freeze, clone-failure — and the new runtime-hooks tests all pass).

- [ ] **Step 6: Mark §8 and commit**

In `docs/extension-model.md` §8 step 6, note `turn:before` (2a-B) is done; `tool:before`/`response:before` remain (2a-B-ii).

```bash
git add src/extension/hook-registry.js test/extension.test.js docs/extension-model.md
git commit -m "perf(extension): skip context clone when an event has no handlers"
```

---

## Done When

- [ ] `node --test test/runtime-hooks.test.js` passes (turn:before block denies; no-hooks unchanged; transform rewrites input; actor cannot be forged).
- [ ] `node --test test/extension.test.js` passes including the no-handler hot-path test.
- [ ] `npm test` passes with no regressions.
- [ ] A `turn:before` block hook denies the turn (`kind: "hook_denied"`) before permission/brain; a transform rewrites `input`; `actor` cannot be forged; a harness with no `hooks` is unchanged; a hookless event pays no clone cost.

## Follow-on (not this plan)

- **2a-B-ii:** wire `tool:before` (around `runMicroHarness`) and `response:before` (after the brain, before the speech emit).
- **Command runner / agent runner:** child-process and LLM hook styles.
