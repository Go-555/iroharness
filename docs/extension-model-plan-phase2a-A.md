# Extension Model — Phase 2a-A (Dispatch Hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `hook-registry.js` `dispatch` production-safe: a throwing handler never crashes the loop (fail-closed on gate/unknown events, fail-open on background/realtime), and a `transform` cannot overwrite caller-designated protected context keys.

**Architecture:** Add a `failModeFor(event)` classifier and wrap each `entry.run` in `dispatch` with try/catch applying that fail mode. Add a third `dispatch` options argument `{ protectedKeys = [] }` (no-op default, backward-compatible) that filters protected keys out of any `transform` merge. All changes are registry-side; the `receive()` wiring that consumes this is phase 2a-B.

**Tech Stack:** Node.js ESM, `node --test`, `node:assert/strict`. `src/extension/hook-registry.js` already defines `isRealtimeEvent`, `REALTIME_HOOK_PREFIXES`, `REALTIME_HOOK_EVENTS`, and `freezeCopy` at module scope.

**Spec:** `docs/extension-model.md` §6 (Error Handling) — reconciled and independently reviewed.

**Scope:** Registry `dispatch` only. No `receive()` wiring (2a-B), no command/agent runners. `failModeFor` and `protectedKeys` are generic mechanisms tested in isolation.

**Grounding facts (verified against the code):**
- Current `dispatch` (no try/catch): `dispatch(event, context = {})` → loops `handlers.get(event)`, on `decision.block` returns `freezeCopy({ event, blocked: true, reason: decision.block.reason ?? null, context: current })`, on `decision.transform` does `current = freezeCopy({ ...current, ...decision.transform })`, else returns `{ event, blocked: false, reason: null, context: current }`.
- `isRealtimeEvent(event)` returns true for `bargein:`/`speech:`/`device:` prefixes; it is module-scoped, so a new `failModeFor` in the same file can call it directly.
- `freezeCopy` is module-scoped.
- Existing callers in `test/extension.test.js` pass exactly 2 args to `dispatch`, so a third arg with a destructuring default `{ protectedKeys = [] } = {}` is backward-compatible.
- Tests import `createHookRegistry` (and `REALTIME_HOOK_EVENTS`) from `../src/extension/hook-registry.js`; runner is `node --test`.

---

## File Structure

- Modify `src/extension/hook-registry.js` — add `FAIL_OPEN_EVENTS` + `failModeFor`; wrap `entry.run` in try/catch; add the `{ protectedKeys }` option + the transform filter.
- Modify `test/extension.test.js` — add the throw-policy and protected-keys tests.
- `docs/extension-model.md` §6/§8 already describe this; Task 3 marks §8 step 5 done.

Test command (this file): `node --test test/extension.test.js`
Full suite: `npm test`

---

## Task 1: `failModeFor` + throw-catch in `dispatch`

**Files:**
- Modify: `src/extension/hook-registry.js`
- Test: `test/extension.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/extension.test.js`:

```js
test("a throwing handler on a gate event fails closed (block)", () => {
  const registry = createHookRegistry();
  registry.register("turn:before", () => {
    throw new Error("boom");
  });
  const result = registry.dispatch("turn:before", { text: "hi" });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /hook error \(fail-closed\)/);
  assert.equal(result.context.text, "hi");
});

test("an unrecognized event fails closed on a handler throw (default-closed)", () => {
  const registry = createHookRegistry();
  registry.register("mystery:event", () => {
    throw new Error("boom");
  });
  assert.equal(registry.dispatch("mystery:event", {}).blocked, true);
});

test("a throwing handler on a background event fails open (skip, continue)", () => {
  const registry = createHookRegistry();
  const ran = [];
  registry.register("turn:after", () => {
    throw new Error("boom");
  });
  registry.register("turn:after", (ctx) => {
    ran.push(ctx.text);
    return undefined;
  });
  const result = registry.dispatch("turn:after", { text: "hi" });
  assert.equal(result.blocked, false); // not blocked
  assert.deepEqual(ran, ["hi"]); // the later handler still ran
});

test("a throwing handler on a realtime event fails open (loop survives)", () => {
  const registry = createHookRegistry();
  registry.register(
    "bargein:detect",
    () => {
      throw new Error("boom");
    },
    { style: "inprocess" },
  );
  assert.equal(registry.dispatch("bargein:detect", {}).blocked, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/extension.test.js`
Expected: FAIL — the throw currently propagates uncaught out of `dispatch`.

- [ ] **Step 3: Write minimal implementation**

In `src/extension/hook-registry.js`, near `isRealtimeEvent` (after the `REALTIME_HOOK_*` definitions), add:

```js
// Background events fail open; gate events (and anything unrecognized) fail closed.
const FAIL_OPEN_EVENTS = Object.freeze(new Set(["tool:after", "turn:after"]));

// A throwing handler fails closed (block) on gate/unknown events; on background
// and realtime events it fails open (the broken handler is skipped).
const failModeFor = (event) =>
  isRealtimeEvent(event) || FAIL_OPEN_EVENTS.has(event) ? "open" : "closed";
```

Then wrap the handler call in `dispatch`'s loop. Change:

```js
    for (const entry of handlers.get(event) || []) {
      const decision = entry.run(current);
```

to:

```js
    for (const entry of handlers.get(event) || []) {
      let decision;
      try {
        decision = entry.run(current);
      } catch (error) {
        if (failModeFor(event) === "closed") {
          return freezeCopy({
            event,
            blocked: true,
            reason: `hook error (fail-closed): ${error.message}`,
            context: current,
          });
        }
        console.warn(`[hooks] skipping failed hook on ${event}: ${error.message}`);
        continue;
      }
```

(The rest of the loop body — the `decision.block` and `decision.transform` handling — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/extension.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extension/hook-registry.js test/extension.test.js
git commit -m "feat(extension): fail-closed/fail-open throw policy in dispatch"
```

---

## Task 2: `protectedKeys` — transform cannot overwrite protected context keys

**Files:**
- Modify: `src/extension/hook-registry.js`
- Test: `test/extension.test.js`

- [ ] **Step 1: Write the failing tests**

Append:

```js
test("transform cannot overwrite a protected key", () => {
  const registry = createHookRegistry();
  registry.register("turn:before", () => ({
    transform: { actor: { role: "owner" }, tag: "x" },
  }));
  const result = registry.dispatch(
    "turn:before",
    { actor: { role: "fan" }, tag: "" },
    { protectedKeys: ["actor"] },
  );
  assert.deepEqual(result.context.actor, { role: "fan" }); // protected, unchanged
  assert.equal(result.context.tag, "x"); // non-protected key applied
});

test("with no protectedKeys (2-arg call) transform merges unrestricted", () => {
  const registry = createHookRegistry();
  registry.register("turn:before", () => ({
    transform: { actor: { role: "owner" } },
  }));
  const result = registry.dispatch("turn:before", { actor: { role: "fan" } });
  assert.deepEqual(result.context.actor, { role: "owner" }); // unrestricted
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/extension.test.js`
Expected: FAIL — the first test fails (`actor` is overwritten because `dispatch` ignores `protectedKeys`); the second already passes.

- [ ] **Step 3: Write minimal implementation**

Change the `dispatch` signature:

```js
  const dispatch = (event, context = {}) => {
```

to:

```js
  const dispatch = (event, context = {}, { protectedKeys = [] } = {}) => {
```

Replace the transform-merge block:

```js
      if (decision && decision.transform) {
        current = freezeCopy({ ...current, ...decision.transform });
      }
```

with:

```js
      if (decision && decision.transform) {
        const applied = {};
        for (const [key, value] of Object.entries(decision.transform)) {
          if (protectedKeys.includes(key)) {
            console.warn(
              `[hooks] ignoring transform of protected key "${key}" on ${event}`,
            );
            continue;
          }
          applied[key] = value;
        }
        current = freezeCopy({ ...current, ...applied });
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/extension.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extension/hook-registry.js test/extension.test.js
git commit -m "feat(extension): protectedKeys guard so transform cannot forge authz fields"
```

---

## Task 3: Full suite + mark phase done

**Files:**
- Modify: `docs/extension-model.md`
- Test: (full suite)

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: full suite green, no regressions (the existing dispatch tests — passthrough, block short-circuit, priority/transform — still pass; the new throw-policy and protectedKeys tests pass).

- [ ] **Step 2: Mark §8 step 5 done**

In `docs/extension-model.md` §8, change step 5 ("Dispatch hardening (2a-A, §6) … **This phase.**") to **Done.**

- [ ] **Step 3: Commit**

```bash
git add docs/extension-model.md
git commit -m "docs(extension): mark §8 dispatch hardening (2a-A) done"
```

---

## Done When

- [ ] `node --test test/extension.test.js` passes, including the new throw-policy (gate fail-closed, unknown fail-closed, background fail-open, realtime fail-open) and protectedKeys (protected dropped + others applied; 2-arg unrestricted) tests.
- [ ] `npm test` passes with no regressions.
- [ ] A throwing in-process handler never propagates out of `dispatch`; gate/unknown events fail closed (block-shaped result), background/realtime fail open (skip + continue).
- [ ] `transform` cannot overwrite a key listed in `protectedKeys`; the default (no `protectedKeys`) leaves the merge unrestricted.

## Follow-on (not this plan)

- **2a-B:** wire `dispatch` into `createIroHarness.receive()` (`turn:before`/`tool:before`/`response:before`), block→reject / transform→apply, passing `protectedKeys: ["actor"]`.
- **Command runner / agent runner:** child-process and LLM hook styles, with their own fail policies.
