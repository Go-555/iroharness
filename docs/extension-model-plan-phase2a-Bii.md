# Extension Model — Phase 2a-B-ii (tool:before / response:before wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the two remaining text-path hook points into `createIroHarness.receive()` — `tool:before` (deny/rewrite a micro-harness delegation) and `response:before` (suppress/rewrite the brain's response) — following the established `turn:before` pattern.

**Architecture:** Same shape as §3.7's `turn:before`. `tool:before` runs inside the `if (route.kind === "work" && route.harnessId)` branch before `runMicroHarness`: `block` → `rejectByHook`, `transform` → reassign `input`. `response:before` runs after `brain.respond` and before the speech emit: `block` → `rejectByHook` (suppress), `transform` → reassign `response`. Both pass `protectedKeys: ["actor"]` and reuse the existing `rejectByHook` and hardened `dispatch` (no-handler hot-path already merged).

**Tech Stack:** Node.js ESM, `node --test`, `node:assert/strict`. `createHookRegistry` + `createStubMicroHarness` are exported from the package.

**Spec:** `docs/extension-model.md` §3.8 (reconciled and independently reviewed).

**Scope:** `tool:before` + `response:before` only. No command/agent runner. tool transform = `input`; response transform = `response`.

**Grounding facts (verified against the code):**
- `turn:before` is already wired (§3.7) and `rejectByHook(input, route, actor, audience, reason)` already exists; `hooks` is already a `createIroHarness` param.
- In `receive()`: the work branch is `if (route.kind === "work" && route.harnessId) { return runMicroHarness(input, route, actor, audience, permission, actorPermissions, contextScopes); }` — this is **after** `permissionPolicy.evaluate`/`rejectByPermission`. Insert `tool:before` inside this branch, before the `return runMicroHarness(...)`.
- `const response = await brain.respond({...})` must become `let response`. After it, `response.text`/`response.emotion` are read in `setState({ speechText, emotion })`, `emit({ type: "speech", text: response.text })`, and the final `return freezeCopy({ kind: "response", ..., text: response.text })`. Reassigning `response` flows to all three.
- A work route is triggered by: a registered `developer` (role with `delegate_work`) + a `codex` micro-harness + input `text: "Codexでこのコードをレビューして"` with `actor: { platform: "slack", platformUserId: "UDEV" }`. `runMicroHarness` creates a PJOS ticket, so if `tool:before` blocks first, `harness.projectOs().tickets.length === 0`.

---

## File Structure

- Modify `src/index.js` — `tool:before` dispatch in the work branch; `const response` → `let response` + `response:before` dispatch after `brain.respond`.
- Modify `test/runtime-hooks.test.js` — extend the test helpers for a work route; add tool:before + response:before tests.
- `docs/extension-model.md` §8 — mark 2a-B-ii done (Task 3).

Test command (this file): `node --test test/runtime-hooks.test.js`
Full suite: `npm test`

**Test-helper additions** (extend the existing helpers at the top of `test/runtime-hooks.test.js`):

```js
// add to the existing src/index.js import:
import {
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
  createStubMicroHarness, // NEW
} from "../src/index.js";
```

Replace `buildHarness` with a version that can set up a work route:

```js
const buildHarness = ({ hooks = null, work = false } = {}) => {
  const userRegistry = createInMemoryUserRegistry();
  if (work) {
    userRegistry.registerUser({
      id: "developer",
      displayName: "Developer",
      role: "developer",
      identities: { slack: "UDEV" },
    });
  }
  const brain = createCapturingBrain("capture");
  const harness = createIroHarness({
    character: { id: "iroha", name: "Iroha", soul: "x", voiceStyle: "short" },
    projectOs: createInMemoryProjectOs(),
    userRegistry,
    brains: { voice: brain, text: brain },
    microHarnesses: work ? [createStubMicroHarness("codex", ["code"])] : [],
    hooks,
  });
  return { harness, brain };
};

const delegateWork = (harness) =>
  harness.receive({
    source: "slack",
    modality: "text",
    text: "Codexでこのコードをレビューして",
    actor: { platform: "slack", platformUserId: "UDEV" },
  });
```

---

## Task 1: `tool:before` — block denies the delegation

**Files:**
- Modify: `src/index.js`
- Test: `test/runtime-hooks.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("a tool:before block hook denies the delegation before the micro-harness runs", async () => {
  const hooks = createHookRegistry();
  hooks.register("tool:before", () => ({ block: { reason: "no tools" } }));
  const { harness } = buildHarness({ hooks, work: true });

  const result = await delegateWork(harness);

  assert.equal(result.kind, "hook_denied");
  assert.equal(result.reason, "no tools");
  assert.equal(harness.projectOs().tickets.length, 0); // runMicroHarness never ran (no ticket)
});

test("with no tool:before hook the work route still delegates", async () => {
  const { harness } = buildHarness({ hooks: createHookRegistry(), work: true });
  const result = await delegateWork(harness);
  assert.equal(result.kind, "delegation"); // unchanged
  assert.equal(harness.projectOs().tickets.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runtime-hooks.test.js`
Expected: FAIL — the first test gets `result.kind === "delegation"` (tool:before not wired).

- [ ] **Step 3: Write minimal implementation**

In `src/index.js`, change the work branch from:

```js
    if (route.kind === "work" && route.harnessId) {
      return runMicroHarness(
        input,
        route,
        actor,
        audience,
        permission,
        actorPermissions,
        contextScopes,
      );
    }
```

to:

```js
    if (route.kind === "work" && route.harnessId) {
      if (hooks) {
        const toolResult = hooks.dispatch(
          "tool:before",
          { input, actor, audience, route },
          { protectedKeys: ["actor"] },
        );
        if (toolResult.blocked) {
          return rejectByHook(input, route, actor, audience, toolResult.reason);
        }
        input = toolResult.context.input ?? input;
      }
      return runMicroHarness(
        input,
        route,
        actor,
        audience,
        permission,
        actorPermissions,
        contextScopes,
      );
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runtime-hooks.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.js test/runtime-hooks.test.js
git commit -m "feat(runtime): tool:before hook can deny a micro-harness delegation"
```

---

## Task 2: `response:before` — block suppresses, transform rewrites the response

**Files:**
- Modify: `src/index.js`
- Test: `test/runtime-hooks.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("a response:before block hook suppresses the brain response", async () => {
  const hooks = createHookRegistry();
  hooks.register("response:before", () => ({ block: { reason: "filtered" } }));
  const { harness } = buildHarness({ hooks });

  const result = await harness.receive({ source: "web", modality: "text", text: "hi" });

  assert.equal(result.kind, "hook_denied"); // brain's "ok" is suppressed
  assert.equal(result.reason, "filtered");
  assert.notEqual(result.text, "ok");
});

test("a response:before transform rewrites the emitted/returned response text", async () => {
  const hooks = createHookRegistry();
  hooks.register("response:before", (ctx) => ({
    transform: { response: { ...ctx.response, text: "MODERATED" } },
  }));
  const { harness } = buildHarness({ hooks });

  const result = await harness.receive({ source: "web", modality: "text", text: "hi" });

  assert.equal(result.kind, "response");
  assert.equal(result.text, "MODERATED"); // the brain said "ok"; the hook rewrote it
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runtime-hooks.test.js`
Expected: FAIL — response:before not wired (block test gets `kind: "response"`/`text: "ok"`; transform test gets `text: "ok"`).

- [ ] **Step 3: Write minimal implementation**

In `src/index.js`, change `const response = await brain.respond({...});` to `let response = await brain.respond({...});`. Immediately after that statement (before the `setState({ mode: MODES.speaking, ... })` that follows), insert:

```js
    if (hooks) {
      const responseResult = hooks.dispatch(
        "response:before",
        { input, actor, audience, route, response },
        { protectedKeys: ["actor"] },
      );
      if (responseResult.blocked) {
        return rejectByHook(input, route, actor, audience, responseResult.reason);
      }
      response = responseResult.context.response ?? response;
    }
```

(The existing `setState`/`emit`/`return` already read `response.text`/`response.emotion`, so they pick up the reassigned value.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runtime-hooks.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.js test/runtime-hooks.test.js
git commit -m "feat(runtime): response:before hook can suppress or rewrite the response"
```

---

## Task 3: actor protected on the new points + full suite + mark done

**Files:**
- Test: `test/runtime-hooks.test.js`
- Modify: `docs/extension-model.md`

- [ ] **Step 1: Write the test**

```js
test("a response:before hook cannot forge the actor (protectedKeys)", async () => {
  const hooks = createHookRegistry();
  hooks.register("response:before", () => ({
    transform: { actor: { user: { role: "owner" } } },
  }));
  const { harness, brain } = buildHarness({ hooks });

  const result = await harness.receive({ source: "web", modality: "text", text: "hi" });

  // actor passed under protectedKeys:["actor"] — forge dropped; the turn still responds.
  assert.equal(result.kind, "response");
  assert.notEqual(result.actor.user.role, "owner");
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test test/runtime-hooks.test.js`
Expected: PASS (Task 2 already passes `protectedKeys: ["actor"]`).

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: full suite green, no regressions (existing harness/runtime tests, the turn:before tests, and the new tool/response tests all pass).

- [ ] **Step 4: Mark §8 done and commit**

In `docs/extension-model.md` §8 step 6, change the 2a-B-ii clause from "**this phase.**" to "**Done.**" (turn:before, tool:before, response:before all wired).

```bash
git add test/runtime-hooks.test.js docs/extension-model.md
git commit -m "test(runtime): response:before protects actor; mark §8 2a-B-ii done"
```

---

## Done When

- [ ] `node --test test/runtime-hooks.test.js` passes (tool:before block denies delegation + no-hook delegates; response:before block suppresses + transform rewrites; response:before actor protected).
- [ ] `npm test` passes with no regressions.
- [ ] `tool:before` denies a micro-harness delegation (no PJOS ticket) and can rewrite `input`; `response:before` suppresses (`hook_denied`) or rewrites the response (`response.text`); `actor` cannot be forged at either point; a no-`hooks` harness is unchanged.

## Follow-on (not this plan)

- **Command runner / agent runner:** child-process and LLM hook styles (§3.2 command/agent), with their own fail policies.
- `tool:after` / `turn:after` background hooks if needed.
