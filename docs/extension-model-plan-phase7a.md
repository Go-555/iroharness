# Extension Model — Phase 7a (async dispatch + command runner factory) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hook registry's `dispatch` asynchronous so a handler may be async, and add a `createCommandHook(spec)` factory that runs an external program as a hook under the JSON stdin/stdout contract — registered directly with `style: "command"`. The JSON manifest loader and `matcher` are out of scope (Phase 7b).

**Architecture:** §3.9 of `docs/extension-model.md`. Two moves: (1) `dispatch` becomes `async` and `await`s each handler — every other behavior (no-handler hot-path, `deepFreeze(structuredClone())`, `failModeFor` fail policy, `protectedKeys`, post-transform semantics) is unchanged; (2) `extension/hook-runners/command.js` exports `createCommandHook` returning an `async (ctx) => decision` that spawns a child via a non-shell `spawn`, writes the context as JSON on stdin, reads a JSON decision on stdout, and maps the §3.4 wire contract to the internal `{ block } / { transform } / undefined` shape. Any failure (non-zero exit, timeout, EPIPE, oversized/unparseable output) throws and is routed by the existing `failModeFor` (gate → fail-closed, background → fail-open).

**Tech Stack:** Node.js ESM, `node --test`, `node:assert/strict`, `node:child_process` (`spawn`). Zero new dependencies. Factory functions returning frozen objects.

**Spec:** `docs/extension-model.md` §3.9 (independently reviewed). Wire contract §3.4; fail policy §6; realtime invariant §3.5.

**Scope:** async `dispatch` + `createCommandHook` + direct registration + export. NO manifest loader, NO `matcher`, NO agent runner.

**Grounding facts (verified against the code):**
- `src/extension/hook-registry.js` `dispatch` is currently **synchronous**; the loop is `decision = entry.run(current)` inside a `try/catch`, with `failModeFor(event)` deciding `"closed"`/`"open"`, a no-handler hot-path (`entries.length === 0`), `freezeContext = deepFreeze(structuredClone())`, the `protectedKeys` transform guard, and a clone-failure `try/catch`.
- `register(event, handler, { style = "inprocess", priority = 0 })` stores `{ style, priority, run: handler }` and **rejects a non-`inprocess` style on a realtime event** (`isRealtimeEvent`). A command hook is just a handler function registered with `style: "command"`; the realtime invariant already covers it.
- `dispatch` is called **synchronously** at exactly these sites: `src/index.js:3072` (`turn:before`), `:3105` (`tool:before`), `:3169` (`response:before`) — all already inside the `async receive`. And ~20 sites in `test/extension.test.js` (synchronous `registry.dispatch(...)`).
- `src/extension/index.js` re-exports the registry; `src/extension/index.d.ts` carries its types; `test/contracts.test.js` forbids `unknown`/`any` in `src/index.d.ts` (and checks `.d.ts` shape — use concrete types).
- Fixtures: run hook programs as `command: process.execPath` (the Node binary), `args: [fixtureScriptPath, ...]` — no shebang/chmod/portability concerns. Fixture scripts read `process.stdin` and write `process.stdout`.

---

## File Structure

- Modify `src/extension/hook-registry.js` — `dispatch` → `async`, `await entry.run(current)`. No other logic change.
- Modify `src/index.js` — `await` the three `hooks.dispatch(...)` calls.
- Modify `test/extension.test.js` — retrofit every `registry.dispatch(...)` to `await` (callbacks → `async`).
- Create `src/extension/hook-runners/command.js` — `createCommandHook(spec)`.
- Modify `src/extension/index.js` — export `createCommandHook`.
- Modify `src/extension/index.d.ts` — types for `createCommandHook` + async `dispatch`.
- Create `test/extension-command.test.js` — command runner happy-path, failure-mode, and security tests.
- Create `test/fixtures/hooks/*.mjs` — fixture hook programs.
- Modify `docs/extension-model.md` — mark §8 item 7a done (final task).

Test commands:
- This phase: `node --test test/extension.test.js test/extension-command.test.js`
- Full suite: `npm test`

---

## Task 1: Make `dispatch` async (breaking change, isolated)

**Files:**
- Modify: `src/extension/hook-registry.js`
- Modify: `src/index.js`
- Modify: `test/extension.test.js`

- [ ] **Step 1: Retrofit the existing dispatch tests to `await`**

In `test/extension.test.js`, make every test callback that calls `registry.dispatch(...)` `async`, and `await` each dispatch. Do not change any asserted value — only add `await`/`async`. **Watch these specific forms** (verified present — they are easy to miss and produce a wrong result once `dispatch` is async, because `(pendingPromise).blocked` is `undefined`):

- **Inline-chained** — `assert.equal(registry.dispatch("mystery:event", {}).blocked, true)` (~line 186) and `assert.equal(registry.dispatch("bargein:detect", {}).blocked, false)` (~line 213) → wrap: `assert.equal((await registry.dispatch(...)).blocked, true)`.
- **Inside a `for..of` loop** — `assert.equal(registry.dispatch(event, {}).blocked, true, ...)` (~line 317): make the test callback `async` and `await` the dispatch inside the loop.
- **Result-discarded side-effect test** — `registry.dispatch("turn:before", {})` whose assertion is on an `order[]` array the handlers push to (~line 166): this MUST be `await`ed, or post-change the handlers run after the assertion and `order` is empty.

Note: `test/runtime-hooks.test.js` (~25 tests) exercises dispatch only **indirectly** through `harness.receive()` (already `async` and awaiting dispatch internally) — it needs **no changes**.

- [ ] **Step 2: Confirm the retrofit is green pre-change (no-op)**

Run: `node --test test/extension.test.js`
Expected: PASS. While `dispatch` is still synchronous, `await` on its return value is a harmless no-op, so the retrofit alone changes nothing. This establishes a clean baseline before the async change; the real proof that every site is correctly awaited is the full suite in Step 5.

- [ ] **Step 3: Make `dispatch` async**

In `src/extension/hook-registry.js`, change `const dispatch = (event, context = {}, { protectedKeys = [] } = {}) => {` to `const dispatch = async (event, context = {}, { protectedKeys = [] } = {}) => {`, and change the handler call from `decision = entry.run(current);` to `decision = await entry.run(current);`. Nothing else changes — the `try/catch` already wraps the call, so an async rejection is caught exactly like a synchronous throw.

- [ ] **Step 4: Update the three `receive()` call sites to `await`**

In `src/index.js`, prefix each of the three `hooks.dispatch(` calls (turn:before, tool:before, response:before) with `await`:
```js
const turnResult = await hooks.dispatch("turn:before", { input, actor, audience, route }, { protectedKeys: ["actor"] });
```
(and likewise for `toolResult` / `responseResult`). They are already inside `async receive`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, unchanged count + green. (Behavior is identical; only the call convention changed. If any `dispatch` result is read without `await` anywhere, it now surfaces as a pending Promise and a test fails — that is the safety net.)

- [ ] **Step 6: Commit**

```bash
git add src/extension/hook-registry.js src/index.js test/extension.test.js
git commit -m "refactor(extension): make hook dispatch async (await each handler)"
```

---

## Task 2: `createCommandHook` — happy paths (deny / transform / pass-through)

**Files:**
- Create: `src/extension/hook-runners/command.js`
- Create: `test/fixtures/hooks/decide.mjs`
- Create: `test/extension-command.test.js`

- [ ] **Step 1: Write the fixture hook program**

`test/fixtures/hooks/decide.mjs` — reads the whole context JSON from stdin, then emits a decision driven by `ctx.input.text` so one fixture covers all three mappings:
```js
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const ctx = JSON.parse(raw);
  const text = ctx?.input?.text ?? "";
  if (text === "deny") {
    process.stdout.write(JSON.stringify({ decision: "deny", reason: "fixture denied" }));
  } else if (text === "rewrite") {
    process.stdout.write(JSON.stringify({ decision: "allow", transform: { input: { ...ctx.input, text: "REWRITTEN" } } }));
  } else {
    process.stdout.write(JSON.stringify({ decision: "allow" }));
  }
});
```

- [ ] **Step 2: Write failing tests**

`test/extension-command.test.js`:
```js
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHookRegistry } from "../src/extension/hook-registry.js";
import { createCommandHook } from "../src/extension/hook-runners/command.js";

const DECIDE = fileURLToPath(new URL("./fixtures/hooks/decide.mjs", import.meta.url));
const nodeHook = (extra = {}) =>
  createCommandHook({ command: process.execPath, args: [DECIDE], timeout: 5000, ...extra });

test("a command hook 'deny' becomes a block", async () => {
  const registry = createHookRegistry();
  registry.register("turn:before", nodeHook(), { style: "command" });
  const result = await registry.dispatch("turn:before", { input: { text: "deny" } });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "fixture denied");
});

test("a command hook 'allow' + transform rewrites the context", async () => {
  const registry = createHookRegistry();
  registry.register("turn:before", nodeHook(), { style: "command" });
  const result = await registry.dispatch("turn:before", { input: { text: "rewrite" } });
  assert.equal(result.blocked, false);
  assert.equal(result.context.input.text, "REWRITTEN");
});

test("a command hook 'allow' with no transform passes through", async () => {
  const registry = createHookRegistry();
  registry.register("turn:before", nodeHook(), { style: "command" });
  const result = await registry.dispatch("turn:before", { input: { text: "hello" } });
  assert.equal(result.blocked, false);
  assert.equal(result.context.input.text, "hello");
});

test("createCommandHook validates its spec at construction", () => {
  assert.throws(() => createCommandHook({ command: "" }), /command/);
  assert.throws(() => createCommandHook({ command: "x", args: "nope" }), /args/);
  assert.throws(() => createCommandHook({ command: "x", args: [1] }), /args/);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test test/extension-command.test.js`
Expected: FAIL — `createCommandHook` does not exist yet.

- [ ] **Step 4: Implement `createCommandHook` (happy path + spec validation)**

`src/extension/hook-runners/command.js`:
```js
import { spawn } from "node:child_process";

const MAX_STDOUT_BYTES = 1024 * 1024; // 1 MiB streaming cap
const DEFAULT_TIMEOUT_MS = 5000;

// Map the §3.4 wire contract to the internal decision shape.
const toDecision = (parsed) => {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("command hook stdout is not a JSON object");
  }
  if (parsed.decision === "deny") {
    return { block: { reason: parsed.reason ?? null } };
  }
  if (parsed.decision === "allow") {
    const t = parsed.transform;
    return t && typeof t === "object" && Object.keys(t).length > 0
      ? { transform: t }
      : undefined;
  }
  throw new Error(`command hook returned an unrecognized decision: ${JSON.stringify(parsed.decision)}`);
};

export const createCommandHook = (spec = {}) => {
  const {
    command,
    args = [],
    timeout = DEFAULT_TIMEOUT_MS,
    cwd = process.cwd(),
    env,
  } = spec;
  if (typeof command !== "string" || command.length === 0) {
    throw new Error("createCommandHook requires a non-empty string command");
  }
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    throw new Error("createCommandHook requires args to be an array of strings");
  }
  // Minimal environment by default: enough to locate an interpreter, never the
  // parent's secrets. spec.env explicitly extends the allow-list.
  const childEnv = { PATH: process.env.PATH, ...(env ?? {}) };

  return (ctx) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, cwd, env: childEnv });
      let stdout = "";
      let bytes = 0;
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(reject, new Error(`command hook timed out after ${timeout}ms`));
      }, timeout);

      child.stdout.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_STDOUT_BYTES) {
          child.kill("SIGKILL");
          finish(reject, new Error("command hook stdout exceeded 1 MiB"));
          return;
        }
        stdout += chunk;
      });
      child.on("error", (error) => finish(reject, error));
      // A child that exits before reading stdin raises EPIPE on the write;
      // catch it so it routes through failModeFor, not as an uncaught rejection.
      child.stdin.on("error", (error) => finish(reject, error));
      child.on("close", (code) => {
        if (settled) return;
        if (code !== 0) {
          finish(reject, new Error(`command hook exited with code ${code}`));
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          finish(reject, new Error("command hook stdout is not valid JSON"));
          return;
        }
        try {
          finish(resolve, toDecision(parsed));
        } catch (error) {
          finish(reject, error);
        }
      });

      try {
        child.stdin.write(JSON.stringify(ctx ?? {}));
        child.stdin.end();
      } catch (error) {
        finish(reject, error);
      }
    });
};
```

- [ ] **Step 5: Run to verify pass**

Run: `node --test test/extension-command.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/extension/hook-runners/command.js test/fixtures/hooks/decide.mjs test/extension-command.test.js
git commit -m "feat(extension): createCommandHook runs an external program as a hook"
```

---

## Task 3: Failure modes route through `failModeFor`

**Files:**
- Create: `test/fixtures/hooks/exit-nonzero.mjs`, `hang.mjs`, `garbage.mjs`, `exit-early.mjs`, `flood.mjs`
- Modify: `test/extension-command.test.js`

- [ ] **Step 1: Write the fixtures**

- `exit-nonzero.mjs`: `process.exit(3);`
- `hang.mjs`: `setTimeout(() => {}, 60000);` (never responds → timeout)
- `garbage.mjs`: `process.stdout.write("this is not json");`
- `exit-early.mjs`: `process.exit(0);` (exits without reading stdin → EPIPE on the parent's write)
- `flood.mjs`: `process.stdout.write("x".repeat(2 * 1024 * 1024));` (> 1 MiB)

- [ ] **Step 2: Write failing tests**

Add to `test/extension-command.test.js` (gate event `turn:before` → fail-closed; background `turn:after` → fail-open):
```js
const hookOf = (file, extra = {}) =>
  createCommandHook({ command: process.execPath, args: [fileURLToPath(new URL(`./fixtures/hooks/${file}`, import.meta.url))], timeout: 1000, ...extra });

const failsClosed = async (file, extra) => {
  const registry = createHookRegistry();
  registry.register("turn:before", hookOf(file, extra), { style: "command" });
  return registry.dispatch("turn:before", { input: { text: "x" } });
};

test("non-zero exit fails closed on a gate event", async () => {
  const r = await failsClosed("exit-nonzero.mjs");
  assert.equal(r.blocked, true);
  assert.match(r.reason, /fail-closed/);
});

test("a timeout fails closed on a gate event", async () => {
  const r = await failsClosed("hang.mjs", { timeout: 200 });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /fail-closed/);
});

test("unparseable stdout fails closed on a gate event", async () => {
  const r = await failsClosed("garbage.mjs");
  assert.equal(r.blocked, true);
});

test("a child that exits without responding fails closed, not an uncaught rejection", async () => {
  // For a small context the kernel pipe buffer absorbs the stdin write, so the
  // child exits 0 with empty stdout -> JSON.parse("") throws -> fail-closed.
  // (The `child.stdin.on("error")` EPIPE handler is the defensive net for the
  // large-context case where the write actually fails; either way the outcome is
  // a controlled block, never an unhandled rejection that would crash the runner.)
  const r = await failsClosed("exit-early.mjs");
  assert.equal(r.blocked, true);
});

test("stdout over 1 MiB fails closed", async () => {
  const r = await failsClosed("flood.mjs");
  assert.equal(r.blocked, true);
});

test("the same failure fails OPEN on a background event", async () => {
  const registry = createHookRegistry();
  registry.register("turn:after", hookOf("exit-nonzero.mjs"), { style: "command" });
  const r = await registry.dispatch("turn:after", { input: { text: "x" } });
  assert.equal(r.blocked, false); // background → fail-open → pass-through
});
```

- [ ] **Step 3: Run to verify**

Run: `node --test test/extension-command.test.js`
Expected: PASS. (`createCommandHook` already throws on each failure; `dispatch`'s `failModeFor` converts the throw to a fail-closed block on `turn:before` and a fail-open pass-through on `turn:after`. The `exit-early` EPIPE is resolved via the `child.stdin.on("error")` handler — if it instead surfaced as an unhandled rejection the test process would crash, which is the regression guard.)

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/hooks/ test/extension-command.test.js
git commit -m "test(extension): command hook failure modes route through failModeFor"
```

---

## Task 4: Security — shell-injection literal args, env isolation, realtime invariant

**Files:**
- Create: `test/fixtures/hooks/echo-argv.mjs`, `echo-env.mjs`
- Modify: `test/extension-command.test.js`

- [ ] **Step 1: Write the fixtures**

- `echo-argv.mjs`: emit the received argv back so the test can prove no shell expansion:
```js
process.stdout.write(JSON.stringify({ decision: "allow", transform: { argv: process.argv.slice(2) } }));
```
- `echo-env.mjs`: emit whether a parent secret leaked + which env keys are visible:
```js
process.stdout.write(JSON.stringify({ decision: "allow", transform: { sawSecret: process.env.IROHA_SECRET ?? null, envKeys: Object.keys(process.env) } }));
```

- [ ] **Step 2: Write the tests**

```js
test("args with shell metacharacters reach the child as literal argv (no shell)", async () => {
  const registry = createHookRegistry();
  const evil = "; rm -rf / #";
  registry.register("turn:before", createCommandHook({
    command: process.execPath,
    args: [fileURLToPath(new URL("./fixtures/hooks/echo-argv.mjs", import.meta.url)), evil],
  }), { style: "command" });
  const r = await registry.dispatch("turn:before", { input: { text: "x" } });
  assert.deepEqual(r.context.argv, [evil]); // passed verbatim, never interpreted
});

test("the child does not inherit the parent's secrets by default", async () => {
  process.env.IROHA_SECRET = "top-secret-token";
  try {
    const registry = createHookRegistry();
    registry.register("turn:before", createCommandHook({
      command: process.execPath,
      args: [fileURLToPath(new URL("./fixtures/hooks/echo-env.mjs", import.meta.url))],
    }), { style: "command" });
    const r = await registry.dispatch("turn:before", { input: { text: "x" } });
    assert.equal(r.context.sawSecret, null); // secret not handed to the hook program
    assert.ok(!r.context.envKeys.includes("IROHA_SECRET"));
  } finally {
    delete process.env.IROHA_SECRET;
  }
});

test("registering a command hook on a realtime event is rejected", () => {
  const registry = createHookRegistry();
  assert.throws(
    () => registry.register("bargein:detect", createCommandHook({ command: process.execPath, args: [] }), { style: "command" }),
    /realtime/,
  );
});
```

- [ ] **Step 3: Run to verify pass**

Run: `node --test test/extension-command.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/hooks/ test/extension-command.test.js
git commit -m "test(extension): command hook shell-injection + env-isolation + realtime guards"
```

---

## Task 5: Export, types, docs

**Files:**
- Modify: `src/extension/index.js`, `src/extension/index.d.ts`
- Modify: `docs/extension-model.md`

- [ ] **Step 1: Export `createCommandHook`**

In `src/extension/index.js`, add `export { createCommandHook } from "./hook-runners/command.js";` (match the existing re-export style).

- [ ] **Step 2: Add types (match the existing extension `.d.ts` style)**

**Important facts (verified):** `test/contracts.test.js` scans only `src/index.d.ts`, `src/adapters/index.d.ts`, `src/testing/index.d.ts` — it does **NOT** scan `src/extension/index.d.ts`. The existing `src/extension/index.d.ts` already uses `unknown` (e.g. `Record<string, unknown>` for the hook context/transform). So **match that existing style — use `unknown`, do not introduce `JsonValue`** (which is not declared in this file and would tighten the existing interface unnecessarily — out of scope for 7a).

Two required changes in `src/extension/index.d.ts`:

1. **Make `dispatch` async in the type** (REQUIRED — not optional): change the existing `dispatch(...): HookDispatchResult` to `dispatch(...): Promise<HookDispatchResult>`. A typed consumer must see the Promise so it knows to `await`.
2. **Add `createCommandHook`**, reusing the file's existing `HookDecision` alias and its inline `Record<string, unknown>` context style (there is no `HookContext` alias — context is written inline) rather than introducing new aliases:
```ts
export interface CommandHookSpec {
  command: string;
  args?: string[];
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
}
// Reuse the file's existing context/decision aliases; the runner returns a Promise.
export function createCommandHook(
  spec: CommandHookSpec,
): (ctx: Record<string, unknown>) => Promise<HookDecision>;
```
Read the current `src/extension/index.d.ts` first and conform exactly to its existing alias names and `unknown` conventions.

- [ ] **Step 3: Assert the export surface**

Add/extend a test asserting `createCommandHook` is exported from `./extension` and returns a function. Check whether `test/package-exports.test.js` enumerates the extension surface — if it does, add `createCommandHook` there. `test/contracts.test.js` does not cover this file, so there is no `any`/`unknown` gate to satisfy here; still run it to confirm no unrelated regression.

Run: `node --test test/contracts.test.js test/package-exports.test.js`
Expected: PASS.

- [ ] **Step 4: Mark §8 7a done**

In `docs/extension-model.md` §8 item 7a, append **Done.** to the 7a clause.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS, green, no regressions.

- [ ] **Step 6: Commit (includes the design doc §3.9)**

```bash
git add src/extension/index.js src/extension/index.d.ts test/ docs/extension-model.md
git commit -m "feat(extension): export createCommandHook; document §3.9; mark §8 7a done"
```

---

## Done When

- [ ] `dispatch` is `async`; all call sites (`receive()` ×3 + every `dispatch` unit test) `await`; full suite green with no behavior change.
- [ ] `createCommandHook` runs an external program: `deny` → block, `allow`+`transform` → transform, `allow` → pass-through; spec validated at construction.
- [ ] Failures (non-zero exit, timeout/SIGKILL, unparseable stdout, EPIPE, > 1 MiB) throw and route through `failModeFor`: fail-closed on `turn:before`, fail-open on `turn:after`; the EPIPE path is a controlled block, never an uncaught rejection.
- [ ] Security: shell metacharacters in `args` reach the child verbatim (no shell); the child does not see a parent secret env var by default; a command hook on a realtime event is rejected.
- [ ] `createCommandHook` is exported from `./extension` with concrete `.d.ts` types; `npm test` green.

## Follow-on (not this plan)

- **7b:** JSON manifest loader (`{ hooks: { event: [{ type, command, matcher, timeout }] } }`) + `matcher` (regex against an event-specific key) for bulk registration.
- **Phase 8:** agent runner (LLM response review).
