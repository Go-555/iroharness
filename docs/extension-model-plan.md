# Extension Model — Phase 1 (Hook Registry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the in-process hook registry that upgrades IroHarness lifecycle events from observe-only into interceptors (block/transform), with the realtime-safety invariant enforced in code.

**Architecture:** A standalone factory module `src/extension/hook-registry.js` exposes `createHookRegistry()`. Handlers register per event with a `style` and `priority`; `dispatch(event, context)` runs them in priority order, short-circuits on `block`, and merges `transform` results into the context. The registry rejects any non-`inprocess` hook on a realtime event (`bargein:*`, `speech:*`, `device:emit`), enforcing the §6 realtime seam from the spec. This phase implements only the in-process style; command/agent runners (Phases 3–4) slot in later behind the same `(ctx) -> decision` shape.

**Tech Stack:** Node.js ESM (`"type": "module"`), Node built-in test runner (`node --test`), `node:assert/strict`. Factory pattern returning `Object.freeze({...})`, matching existing `src/index.js` exports. Subsystem packaging follows `src/public-mode/` (own `index.js` + `index.d.ts` + a `./extension` entry in `package.json` `exports`).

**Spec:** `docs/extension-model.md` (§3 Hooks, §3.5 registry invariant, §5 module boundaries).

**Scope:** Phase 1 only (spec §8.1). Phases 2–4 (skill loader/injector, command runner, agent runner) are follow-on plans. This plan produces a working, tested, independently-shippable hook registry.

**Working branch:** Implement on a dedicated branch `feat/extension-hooks` cut from `main` (separate from the `docs/extension-model` docs branch). Create a worktree for it before starting.

---

## File Structure

- Create `src/extension/hook-registry.js` — the registry factory (register, dispatch, realtime invariant). One responsibility: in-process hook dispatch with the safety invariant.
- Create `src/extension/index.js` — subsystem entrypoint, re-exports the registry.
- Create `src/extension/index.d.ts` — type declarations for the entrypoint.
- Create `test/extension.test.js` — all Phase 1 tests.
- Modify `package.json` — add the `./extension` subpath to `exports`.

---

## Task 1: Registry skeleton — passthrough and single in-process handler

**Files:**
- Create: `src/extension/hook-registry.js`
- Test: `test/extension.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/extension.test.js
import assert from "node:assert/strict";
import test from "node:test";

import { createHookRegistry } from "../src/extension/hook-registry.js";

test("dispatch with no handlers passes the context through unblocked", () => {
  const registry = createHookRegistry();
  const result = registry.dispatch("turn:before", { text: "hi" });

  assert.equal(result.blocked, false);
  assert.equal(result.context.text, "hi");
});

test("a single in-process handler runs and can pass through", () => {
  const registry = createHookRegistry();
  const seen = [];
  registry.register("turn:before", (ctx) => {
    seen.push(ctx.text);
    return undefined;
  });

  const result = registry.dispatch("turn:before", { text: "hi" });

  assert.deepEqual(seen, ["hi"]);
  assert.equal(result.blocked, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/extension.test.js`
Expected: FAIL — cannot find module `../src/extension/hook-registry.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/extension/hook-registry.js
const freezeCopy = (value) => Object.freeze({ ...value });

export const createHookRegistry = () => {
  const handlers = new Map();

  const register = (event, handler) => {
    const next = [...(handlers.get(event) || []), { run: handler }];
    handlers.set(event, next);
    return registry;
  };

  const dispatch = (event, context = {}) => {
    let current = freezeCopy(context);
    for (const entry of handlers.get(event) || []) {
      entry.run(current);
    }
    return freezeCopy({ event, blocked: false, reason: null, context: current });
  };

  const registry = Object.freeze({ kind: "hook-registry", register, dispatch });
  return registry;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/extension.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/hook-registry.js test/extension.test.js
git commit -m "feat(extension): hook registry skeleton with in-process dispatch"
```

---

## Task 2: Block short-circuits remaining handlers

**Files:**
- Modify: `src/extension/hook-registry.js`
- Test: `test/extension.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("a handler returning block stops dispatch and skips later handlers", () => {
  const registry = createHookRegistry();
  const ran = [];
  registry.register("tool:before", () => {
    ran.push("first");
    return { block: { reason: "denied" } };
  });
  registry.register("tool:before", () => {
    ran.push("second");
    return undefined;
  });

  const result = registry.dispatch("tool:before", { tool: "codex" });

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "denied");
  assert.deepEqual(ran, ["first"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/extension.test.js`
Expected: FAIL — `result.blocked` is `false` (block not yet handled).

- [ ] **Step 3: Write minimal implementation**

Replace the `dispatch` loop body in `src/extension/hook-registry.js`:

```js
  const dispatch = (event, context = {}) => {
    let current = freezeCopy(context);
    for (const entry of handlers.get(event) || []) {
      const decision = entry.run(current);
      if (decision && decision.block) {
        return freezeCopy({
          event,
          blocked: true,
          reason: decision.block.reason ?? null,
          context: current
        });
      }
    }
    return freezeCopy({ event, blocked: false, reason: null, context: current });
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/extension.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/hook-registry.js test/extension.test.js
git commit -m "feat(extension): block decision short-circuits dispatch"
```

---

## Task 3: Priority ordering and transform merge

**Files:**
- Modify: `src/extension/hook-registry.js`
- Test: `test/extension.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("handlers run in priority order and transform merges into the context", () => {
  const registry = createHookRegistry();
  const order = [];
  registry.register(
    "turn:before",
    (ctx) => {
      order.push("low");
      return { transform: { tag: `${ctx.tag || ""}low` } };
    },
    { priority: 0 }
  );
  registry.register(
    "turn:before",
    (ctx) => {
      order.push("high");
      return { transform: { tag: `${ctx.tag || ""}high-` } };
    },
    { priority: 10 }
  );

  const result = registry.dispatch("turn:before", { tag: "" });

  assert.deepEqual(order, ["high", "low"]);
  assert.equal(result.context.tag, "high-low");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/extension.test.js`
Expected: FAIL — order is `["low","high"]` and/or `transform` not applied.

- [ ] **Step 3: Write minimal implementation**

Update `register` to accept options and sort by priority, and update `dispatch` to apply `transform`:

```js
  const register = (event, handler, { style = "inprocess", priority = 0 } = {}) => {
    const next = [...(handlers.get(event) || []), { style, priority, run: handler }];
    next.sort((a, b) => b.priority - a.priority);
    handlers.set(event, next);
    return registry;
  };
```

In `dispatch`, after the `block` check, before the loop ends:

```js
      if (decision && decision.transform) {
        current = freezeCopy({ ...current, ...decision.transform });
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/extension.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/hook-registry.js test/extension.test.js
git commit -m "feat(extension): priority ordering and transform merge"
```

---

## Task 4: Realtime invariant — reject non-in-process hooks on realtime events

**Files:**
- Modify: `src/extension/hook-registry.js`
- Test: `test/extension.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { createHookRegistry, REALTIME_HOOK_EVENTS } from "../src/extension/hook-registry.js";

test("registering a command/agent hook on a realtime event throws", () => {
  const registry = createHookRegistry();

  assert.throws(
    () => registry.register("bargein:detect", () => undefined, { style: "command" }),
    /realtime/
  );
  assert.throws(
    () => registry.register("speech:before", () => undefined, { style: "agent" }),
    /realtime/
  );
});

test("an in-process hook on a realtime event is allowed", () => {
  const registry = createHookRegistry();
  assert.doesNotThrow(() =>
    registry.register("bargein:detect", () => ({ block: { reason: "interrupted" } }), {
      style: "inprocess"
    })
  );
});

test("REALTIME_HOOK_EVENTS lists the protected realtime points", () => {
  assert.ok(REALTIME_HOOK_EVENTS.has("bargein:detect"));
  assert.ok(REALTIME_HOOK_EVENTS.has("speech:before"));
  assert.ok(REALTIME_HOOK_EVENTS.has("speech:chunk"));
  assert.ok(REALTIME_HOOK_EVENTS.has("device:emit"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/extension.test.js`
Expected: FAIL — `REALTIME_HOOK_EVENTS` is undefined and `register` does not throw.

- [ ] **Step 3: Write minimal implementation**

At the top of `src/extension/hook-registry.js`. Enforcement is **prefix-based** to
match spec §3.5 (`bargein:*`, `speech:*`, `device:*`), so a future realtime event
(e.g. `speech:end`) is covered automatically and cannot silently bypass the
invariant. The concrete set is exported alongside for discovery and tests.

```js
// Enforcement source of truth: any event under these prefixes is realtime (spec §3.5).
const REALTIME_HOOK_PREFIXES = Object.freeze(["bargein:", "speech:", "device:"]);

const isRealtimeEvent = (event) =>
  REALTIME_HOOK_PREFIXES.some((prefix) => event.startsWith(prefix));

// Concrete realtime events currently defined (spec §3.3) — for discovery/tests.
export const REALTIME_HOOK_EVENTS = Object.freeze(
  new Set(["bargein:detect", "speech:before", "speech:chunk", "device:emit"])
);
```

Add the guard at the start of `register`, before pushing the handler (Task 5
later inserts input validation ahead of this guard). The factory signature stays
`createHookRegistry = ()` as in Task 1:

```js
    if (isRealtimeEvent(event) && style !== "inprocess") {
      throw new Error(
        `hook style "${style}" is not allowed on realtime event "${event}"; realtime hooks must be in-process`
      );
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/extension.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/hook-registry.js test/extension.test.js
git commit -m "feat(extension): enforce realtime in-process-only invariant"
```

---

## Task 5: Input validation

**Files:**
- Modify: `src/extension/hook-registry.js`
- Test: `test/extension.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("register rejects an empty event name and a non-function handler", () => {
  const registry = createHookRegistry();

  assert.throws(() => registry.register("", () => undefined), /event/);
  assert.throws(() => registry.register("turn:before", null), /handler/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/extension.test.js`
Expected: FAIL — no validation errors thrown.

- [ ] **Step 3: Write minimal implementation**

At the start of `register`, before the realtime guard:

```js
    if (typeof event !== "string" || event.length === 0) {
      throw new Error("hook registry register requires a non-empty event name");
    }
    if (typeof handler !== "function") {
      throw new Error("hook registry register requires a handler function");
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/extension.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/hook-registry.js test/extension.test.js
git commit -m "feat(extension): validate register inputs"
```

---

## Task 6: Package export wiring

**Files:**
- Create: `src/extension/index.js`
- Create: `src/extension/index.d.ts`
- Modify: `package.json` (the `exports` map)
- Test: `test/extension.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("the ./extension subpath export resolves the registry", async () => {
  const mod = await import("iroharness/extension");
  assert.equal(typeof mod.createHookRegistry, "function");
  assert.ok(mod.REALTIME_HOOK_EVENTS.has("bargein:detect"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/extension.test.js`
Expected: FAIL — `iroharness/extension` is not a resolvable export (ERR_PACKAGE_PATH_NOT_EXPORTED).

- [ ] **Step 3: Write minimal implementation**

Create `src/extension/index.js`:

```js
export { createHookRegistry, REALTIME_HOOK_EVENTS } from "./hook-registry.js";
```

Create `src/extension/index.d.ts`:

```ts
export type HookStyle = "inprocess" | "command" | "agent";

export interface HookDecision {
  block?: { reason?: string };
  transform?: Record<string, unknown>;
}

export interface HookDispatchResult {
  event: string;
  blocked: boolean;
  reason: string | null;
  context: Record<string, unknown>;
}

export interface HookRegistry {
  kind: "hook-registry";
  register(
    event: string,
    handler: (context: Record<string, unknown>) => HookDecision | undefined,
    options?: { style?: HookStyle; priority?: number }
  ): HookRegistry;
  dispatch(event: string, context?: Record<string, unknown>): HookDispatchResult;
}

export function createHookRegistry(options?: {
  realtimeEvents?: ReadonlySet<string>;
}): HookRegistry;

export const REALTIME_HOOK_EVENTS: ReadonlySet<string>;
```

Add to the `exports` map in `package.json`, after the `./public-memory` entry:

```json
    "./extension": {
      "types": "./src/extension/index.d.ts",
      "default": "./src/extension/index.js"
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/extension.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: all existing tests plus the new `test/extension.test.js` pass.

- [ ] **Step 6: Commit**

```bash
git add src/extension/index.js src/extension/index.d.ts package.json test/extension.test.js
git commit -m "feat(extension): expose ./extension package entrypoint"
```

---

## Done When

- [ ] `node --test test/extension.test.js` passes (9 tests).
- [ ] `npm test` passes with no regressions.
- [ ] `src/extension/` contains `hook-registry.js`, `index.js`, `index.d.ts`.
- [ ] `iroharness/extension` resolves `createHookRegistry` and `REALTIME_HOOK_EVENTS`.

## Follow-on Plans (not this plan)

- **Phase 2:** `skill-loader.js` + `skill-injector.js` — SKILL.md discovery, view/requires/capability gating, prompt injection (spec §4).
- **Phase 3:** `hook-runners/command.js` — declarative manifest + child-process JSON contract for text-path gates (spec §3.2, §3.4).
- **Phase 4:** `hook-runners/agent.js` — LLM-judgment hooks for `response:before` (spec §3.2).
- **Integration (later):** wire `dispatch` into the existing realtime path (`createRealtimeBargeInGate`, `createJavascriptRealtimeCore`) and the text turn pipeline, per spec §3.6. Kept out of Phase 1 so the registry lands as an isolated, fully-tested unit first.
- **Error handling (spec §6):** the fail-closed/fail-open behavior on a throwing in-process handler is tied to the gate/background distinction that the command/agent runners introduce, so it lands with Phase 3 (command runner) — not Phase 1. Until then, `dispatch` lets a handler throw propagate; Phase 3 wraps dispatch with the per-event fail policy and the catch that prevents a throwing handler from crashing the loop.
