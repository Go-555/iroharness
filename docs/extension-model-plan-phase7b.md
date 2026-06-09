# Extension Model — Phase 7b (command manifest loader + matcher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JSON manifest loader that registers `command` hooks in bulk, each gated by a `matcher` (regex against a route-derived per-event key). Purely additive — reuses 7a's `createCommandHook`, wraps each hook in a matcher gate, and does NOT modify `dispatch` or `register`.

**Architecture:** §3.10 of `docs/extension-model.md`. `registerCommandManifest(registry, manifest, { baseDir })` validates a parsed manifest object and, for each `{ type:"command", command, matcher?, timeout?, args?, cwd?, env?, priority? }` entry, builds a `createCommandHook` (resolving a relative `command` against `baseDir`), wraps it in a gate `(ctx) => re.test(keyFor(event, ctx)) ? hook(ctx) : undefined`, and `register`s it with `{ style:"command", priority }`. The realtime invariant is still enforced by `register`. `loadCommandManifestFile(registry, path)` is a thin FS wrapper. Validation is fail-loud (never a silent drop), naming the event + entry index.

**Tech Stack:** Node.js ESM, `node --test`, `node:assert/strict`, `node:path` (isAbsolute/resolve/dirname), `node:fs` (readFileSync) for the file wrapper. Zero new deps.

**Spec:** `docs/extension-model.md` §3.10 (independently reviewed). Wire contract / createCommandHook §3.9. Realtime invariant §3.5. Fail-loud §6.

**Scope:** manifest loader + matcher + validation + file wrapper + export/types. NO agent runner (Phase 8). NO changes to `dispatch`/`register`/`createCommandHook`.

**Grounding facts (verified against the code):**
- `npm test` is `node --test "test/*.test.js"` — fixtures under `test/fixtures/` are NOT discovered as tests. Fixture hook scripts are plain (no sentinel).
- `createCommandHook(spec)` is exported from `./extension` and from `src/extension/hook-runners/command.js`; spec = `{ command, args=[], timeout=5000, cwd=process.cwd(), env }`; returns an async `(ctx) => Promise<decision>`. It validates `command` non-empty string and `args` string array at construction.
- `createHookRegistry().register(event, handler, { style, priority })` throws for `style:"command"` on a realtime event (`bargein:`/`speech:`/`device:`). `dispatch` is async and awaits each handler; a handler returning `undefined` is pass-through.
- `route` (in a dispatch context) is `{ kind, harnessId, reason }` — `kind` ∈ `stream`/`voice`/`deep`/`text`/`work`; `harnessId` is the delegation target (or null).
- `src/extension/index.js` re-exports from `./hook-runners/command.js`; `src/extension/index.d.ts` carries the types (uses `unknown`, no `JsonValue`); `test/contracts.test.js` does NOT scan `src/extension/index.d.ts`.

---

## File Structure

- Create `src/extension/hook-runners/manifest.js` — `registerCommandManifest`, `loadCommandManifestFile`, the `keyFor` resolver, and the entry validator.
- Modify `src/extension/index.js` — export both new functions.
- Modify `src/extension/index.d.ts` — add manifest types.
- Create `test/extension-manifest.test.js` — unit + integration tests.
- Create `test/fixtures/hooks/allow.mjs` — a plain fixture hook that always allows (for integration).
- Create `test/fixtures/manifests/basic.json` — a manifest fixture for the file-wrapper test.
- Modify `docs/extension-model.md` — mark §8 7b done (final task).

Test commands:
- This phase: `node --test "test/extension-manifest.test.js"`
- Full suite: `npm test`

---

## Task 1: core `registerCommandManifest` — keyFor resolver + matcher gate (happy path)

**Files:**
- Create: `src/extension/hook-runners/manifest.js`
- Create: `test/extension-manifest.test.js`

The tests use an INLINE fake hook by registering a manifest whose `command` runs a real fixture — but to keep Task 1 fast and FS-light, test the GATE behavior with a stubbed hook builder is not possible (the loader builds hooks internally). Instead, Task 1 tests the gate via a real fixture that echoes a marker, OR more simply asserts which entries RUN by using a fixture that always allows and checking the dispatched result. To isolate matcher logic without spawning, **export `keyFor` and test it directly**, then test the full registerCommandManifest with a real fixture in Task 3. So Task 1 = `keyFor` + the core wiring with a real fixture for one matcher case.

- [ ] **Step 1: Write failing tests**

`test/extension-manifest.test.js`:
```js
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createHookRegistry } from "../src/extension/hook-registry.js";
import {
  registerCommandManifest,
  keyFor,
} from "../src/extension/hook-runners/manifest.js";

const HOOKS_DIR = dirname(fileURLToPath(new URL("./fixtures/hooks/allow.mjs", import.meta.url)));

// keyFor: tool:before -> harnessId, everything else -> route.kind
test("keyFor uses route.harnessId for tool:before", () => {
  assert.equal(keyFor("tool:before", { route: { harnessId: "codex", kind: "work" } }), "codex");
});
test("keyFor uses route.kind for other events", () => {
  assert.equal(keyFor("turn:before", { route: { kind: "stream" } }), "stream");
});
test("keyFor falls back to empty string when route/field absent", () => {
  assert.equal(keyFor("tool:before", {}), "");
  assert.equal(keyFor("turn:before", { route: {} }), "");
});

// matcher gate: a non-matching entry passes through (returns undefined),
// a matching entry runs the command hook.
const manifestWith = (matcher) => ({
  hooks: {
    "turn:before": [
      { type: "command", matcher, command: process.execPath, args: [`${HOOKS_DIR}/allow.mjs`] },
    ],
  },
});

test("a matcher that matches route.kind runs the hook", async () => {
  const registry = createHookRegistry();
  registerCommandManifest(registry, manifestWith("stream"), { baseDir: HOOKS_DIR });
  const r = await registry.dispatch("turn:before", { route: { kind: "stream" }, input: { text: "x" } });
  assert.equal(r.blocked, false); // allow.mjs returns allow -> pass-through, no error
  assert.equal(r.context.marker, "ran"); // allow.mjs sets transform.marker
});

test("a matcher that does NOT match the route.kind skips the hook", async () => {
  const registry = createHookRegistry();
  registerCommandManifest(registry, manifestWith("voice"), { baseDir: HOOKS_DIR });
  const r = await registry.dispatch("turn:before", { route: { kind: "stream" }, input: { text: "x" } });
  assert.equal(r.blocked, false);
  assert.equal(r.context.marker, undefined); // hook gated out -> never ran -> no transform
});

test("an absent matcher matches everything", async () => {
  const registry = createHookRegistry();
  registerCommandManifest(registry, { hooks: { "turn:before": [
    { type: "command", command: process.execPath, args: [`${HOOKS_DIR}/allow.mjs`] },
  ] } }, { baseDir: HOOKS_DIR });
  const r = await registry.dispatch("turn:before", { route: { kind: "anything" }, input: { text: "x" } });
  assert.equal(r.context.marker, "ran");
});
```

- [ ] **Step 2: Create the fixture** `test/fixtures/hooks/allow.mjs` (plain script):
```js
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ decision: "allow", transform: { marker: "ran" } }));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test "test/extension-manifest.test.js"`
Expected: FAIL — `manifest.js` / `registerCommandManifest` / `keyFor` do not exist.

- [ ] **Step 4: Implement the core** `src/extension/hook-runners/manifest.js`:
```js
import { isAbsolute, resolve } from "node:path";
import { createCommandHook } from "./command.js";

// The matcher's key is route-derived and per-event (§3.10): tool:before keys on
// the delegation target; every other event keys on the route kind.
export const keyFor = (event, ctx) =>
  event === "tool:before"
    ? ctx?.route?.harnessId ?? ""
    : ctx?.route?.kind ?? "";

const buildGatedHook = (event, entry, index, baseDir) => {
  // entry-level validation lands in Task 2; Task 1 assumes well-formed entries.
  const command = isAbsolute(entry.command)
    ? entry.command
    : resolve(baseDir, entry.command);
  const hook = createCommandHook({
    command,
    args: entry.args,
    timeout: entry.timeout,
    cwd: entry.cwd,
    env: entry.env,
  });
  let re = null;
  if (entry.matcher !== undefined) {
    re = new RegExp(entry.matcher);
  }
  return (ctx) => (!re || re.test(keyFor(event, ctx)) ? hook(ctx) : undefined);
};

export const registerCommandManifest = (
  registry,
  manifest,
  { baseDir = process.cwd() } = {},
) => {
  const hooks = manifest?.hooks ?? {};
  for (const [event, entries] of Object.entries(hooks)) {
    entries.forEach((entry, index) => {
      const gated = buildGatedHook(event, entry, index, baseDir);
      registry.register(event, gated, {
        style: "command",
        priority: entry.priority ?? 0,
      });
    });
  }
  return registry;
};
```

- [ ] **Step 5: Run to verify pass**

Run: `node --test "test/extension-manifest.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/extension/hook-runners/manifest.js test/extension-manifest.test.js test/fixtures/hooks/allow.mjs
git commit -m "feat(extension): registerCommandManifest with route-keyed matcher gate"
```

---

## Task 2: fail-loud load-time validation (never a silent drop)

**Files:**
- Modify: `src/extension/hook-runners/manifest.js`
- Modify: `test/extension-manifest.test.js`

- [ ] **Step 1: Write failing tests** (append). Each malformed manifest throws a load-time error naming the event + index; a well-formed `agent` type throws the Phase-8 message; an absent `hooks` key is a no-op; a realtime event surfaces the §3.5 rejection.
```js
const reg = () => createHookRegistry();
const load = (manifest) => registerCommandManifest(reg(), manifest, { baseDir: HOOKS_DIR });
const cmd = (extra) => ({ type: "command", command: process.execPath, args: [`${HOOKS_DIR}/allow.mjs`], ...extra });

test("an absent hooks key is a no-op (not an error)", () => {
  assert.doesNotThrow(() => registerCommandManifest(reg(), {}, { baseDir: HOOKS_DIR }));
});
test("hooks must be an object", () => {
  assert.throws(() => load({ hooks: [] }), /hooks/);
});
test("an event value must be an array", () => {
  assert.throws(() => load({ hooks: { "turn:before": {} } }), /turn:before/);
});
test("a non-object entry throws naming event+index", () => {
  assert.throws(() => load({ hooks: { "turn:before": ["nope"] } }), /turn:before.*\b0\b/);
});
test("type is required and must be command", () => {
  assert.throws(() => load({ hooks: { "turn:before": [{ command: "x" }] } }), /type/);
});
test("type agent is a Phase 8 load error", () => {
  assert.throws(() => load({ hooks: { "response:before": [{ type: "agent", prompt: "x" }] } }), /agent/i);
});
test("command must be a non-empty string", () => {
  assert.throws(() => load({ hooks: { "turn:before": [{ type: "command", command: "" }] } }), /command/);
});
test("a non-string matcher throws", () => {
  assert.throws(() => load({ hooks: { "turn:before": [cmd({ matcher: 42 })] } }), /matcher/);
});
test("an invalid regex matcher throws naming event+index", () => {
  assert.throws(() => load({ hooks: { "turn:before": [cmd({ matcher: "(" })] } }), /turn:before.*\b0\b/);
});
test("a command hook on a realtime event is rejected (realtime invariant)", () => {
  assert.throws(() => load({ hooks: { "bargein:detect": [cmd()] } }), /realtime/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test "test/extension-manifest.test.js"`
Expected: FAIL — validation not implemented (entries currently assumed well-formed; some throw the wrong/no error).

- [ ] **Step 3: Add validation to `manifest.js`**

Add a validator used by `registerCommandManifest` before building each hook. Throw `Error` messages that include the event and index. Validate: `hooks` is a plain object; each event value is an array; each entry is a non-null object; `type === "command"` (an `agent` type → "agent hooks are not supported until Phase 8"; any other/missing type → error); `command` is a non-empty string; `matcher` (if present) is a string that compiles as a RegExp (catch the RegExp throw and rethrow with event+index). Let `register`'s realtime rejection propagate (it already names the event). Sketch:
```js
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const validateEntry = (event, entry, index) => {
  const at = `hooks["${event}"][${index}]`;
  if (!isPlainObject(entry)) throw new Error(`${at}: entry must be an object`);
  if (entry.type === "agent") throw new Error(`${at}: agent hooks are not supported until Phase 8`);
  if (entry.type !== "command") throw new Error(`${at}: type must be "command" (got ${JSON.stringify(entry.type)})`);
  if (typeof entry.command !== "string" || entry.command.length === 0) throw new Error(`${at}: command must be a non-empty string`);
  if (entry.matcher !== undefined) {
    if (typeof entry.matcher !== "string") throw new Error(`${at}: matcher must be a string`);
    try { new RegExp(entry.matcher); } catch (e) { throw new Error(`${at}: invalid matcher regex: ${e.message}`); }
  }
};
```
And in `registerCommandManifest`: after `const hooks = manifest?.hooks ?? {}`, assert `isPlainObject(hooks)` (throw `manifest.hooks must be an object`); for each `[event, entries]`, assert `Array.isArray(entries)` (throw naming the event); then `validateEntry(event, entry, index)` before `buildGatedHook`. `args`/`timeout`/`cwd`/`env` are validated by `createCommandHook`; if it throws, allow it to propagate (acceptable — Task 1 builds the hook after validation). The `buildGatedHook` regex compile is now redundant with the validator's compile but harmless; keep the validator as the source of the friendly message.

- [ ] **Step 4: Run to verify pass**

Run: `node --test "test/extension-manifest.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/extension/hook-runners/manifest.js test/extension-manifest.test.js
git commit -m "feat(extension): fail-loud manifest validation (event+index, agent->Phase 8)"
```

---

## Task 3: `loadCommandManifestFile` + `resolveCommand` (FS wrapper + path resolution)

**Files:**
- Modify: `src/extension/hook-runners/manifest.js`, `test/fixtures/hooks/allow.mjs`
- Create: `test/fixtures/manifests/basic.json`
- Modify: `test/extension-manifest.test.js`

**Path-resolution rule (§3.10, execvp convention):** a `command` that **contains a
path separator** (`./x`, `../x`, `/abs/x`) is a path → resolved against `baseDir`;
a **bare name** (`node`, `bash` — no separator) is left untouched for `PATH`
lookup. This is implemented as an exported `resolveCommand(command, baseDir)` so
it can be unit-tested directly without spawning.

- [ ] **Step 1: Make the fixture directly spawnable** — prepend a shebang to
`test/fixtures/hooks/allow.mjs` (line 1: `#!/usr/bin/env node`) and mark it
executable: `chmod +x test/fixtures/hooks/allow.mjs` (git preserves the mode).
The shebang is a no-op when the fixture is run as `node allow.mjs` (Task 1), and
lets it run directly when spawned by an absolute path (this task's file wrapper).

- [ ] **Step 2: Create the manifest fixture** `test/fixtures/manifests/basic.json`
(the hook lives one dir up, in `../hooks/`; the `../hooks/...` path contains a
separator → resolved against the manifest's own dir by `loadCommandManifestFile`):
```json
{
  "hooks": {
    "turn:before": [
      { "type": "command", "command": "../hooks/allow.mjs" }
    ]
  }
}
```

- [ ] **Step 3: Write failing tests** (append). Unit-test `resolveCommand`
directly; integration-test the file wrapper (positive spawn) + malformed JSON:
```js
import { isAbsolute } from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCommand, loadCommandManifestFile } from "../src/extension/hook-runners/manifest.js";

test("resolveCommand resolves a separator-bearing path against baseDir", () => {
  assert.equal(resolveCommand("./x.sh", "/base"), "/base/x.sh");
  assert.equal(resolveCommand("../hooks/x", "/base/sub"), "/base/hooks/x");
  assert.equal(resolveCommand("/abs/x", "/base"), "/abs/x");
});
test("resolveCommand leaves a bare name for PATH lookup", () => {
  assert.equal(resolveCommand("node", "/base"), "node");
  assert.equal(resolveCommand("bash", "/base"), "bash");
});

test("loadCommandManifestFile reads, parses, resolves, and the hook runs", async () => {
  const MANIFEST = fileURLToPath(new URL("./fixtures/manifests/basic.json", import.meta.url));
  const registry = createHookRegistry();
  loadCommandManifestFile(registry, MANIFEST);
  const r = await registry.dispatch("turn:before", { route: { kind: "x" }, input: { text: "y" } });
  assert.equal(r.blocked, false);
  assert.equal(r.context.marker, "ran"); // ../hooks/allow.mjs resolved + spawned via shebang
});

test("a malformed JSON manifest file throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroha-manifest-"));
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{ not json");
  const registry = createHookRegistry();
  assert.throws(() => loadCommandManifestFile(registry, bad), /parse|JSON/i);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `node --test "test/extension-manifest.test.js"`
Expected: FAIL — `resolveCommand` / `loadCommandManifestFile` not exported yet; the current `buildGatedHook` resolves via `isAbsolute`-only logic from Task 1, not the separator rule.

- [ ] **Step 5: Implement** in `manifest.js`. Add `resolveCommand`, use it in
`buildGatedHook` (replacing the Task 1 inline resolution), and add the file wrapper:
```js
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// execvp convention: a command containing a path separator is a path (resolved
// against baseDir); a bare name is left for PATH lookup. On POSIX an absolute
// path always contains "/", so the separator test subsumes isAbsolute.
export const resolveCommand = (command, baseDir) =>
  command.includes("/") ? resolve(baseDir, command) : command;

// in buildGatedHook, replace the command resolution with:
//   const command = resolveCommand(entry.command, baseDir);

export const loadCommandManifestFile = (registry, path) => {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read/parse manifest "${path}": ${error.message}`);
  }
  return registerCommandManifest(registry, manifest, { baseDir: dirname(path) });
};
```

- [ ] **Step 6: Run + full suite**

Run: `node --test "test/extension-manifest.test.js"` then `npm test`
Expected: PASS, no hang. Report counts.

- [ ] **Step 7: Commit**
```bash
git add src/extension/hook-runners/manifest.js test/extension-manifest.test.js test/fixtures/hooks/allow.mjs test/fixtures/manifests/basic.json
git commit -m "feat(extension): loadCommandManifestFile + execvp-style command path resolution"
```

---

## Task 4: export, types, docs

**Files:**
- Modify: `src/extension/index.js`, `src/extension/index.d.ts`, `test/extension.test.js`, `docs/extension-model.md`

- [ ] **Step 1: Export** `registerCommandManifest` and `loadCommandManifestFile` from `src/extension/index.js` (match the existing re-export style):
```js
export { registerCommandManifest, loadCommandManifestFile } from "./hook-runners/manifest.js";
```
`keyFor` and `resolveCommand` stay module-internal (tests import them directly from `./hook-runners/manifest.js`); only the two loader functions are on the public `./extension` surface.

- [ ] **Step 2: Types** in `src/extension/index.d.ts` (match the existing `unknown` style; read the file first). Add:
```ts
export interface CommandManifestEntry {
  type: "command";
  command: string;
  matcher?: string;
  args?: string[];
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  priority?: number;
}
export interface CommandManifest {
  hooks?: Record<string, CommandManifestEntry[]>;
}
export function registerCommandManifest(
  registry: HookRegistry,
  manifest: CommandManifest,
  options?: { baseDir?: string },
): HookRegistry;
export function loadCommandManifestFile(registry: HookRegistry, path: string): HookRegistry;
```

- [ ] **Step 3: Assert the export surface** — extend the existing `./extension` resolution test in `test/extension.test.js` with `assert.equal(typeof mod.registerCommandManifest, "function")` and `assert.equal(typeof mod.loadCommandManifestFile, "function")`. No new test file.

- [ ] **Step 4: Mark §8 7b done** — in `docs/extension-model.md` §8 item 7b, append **Done.**

- [ ] **Step 5: Full suite + check**

Run: `npm test` (report count) and `npm run check`.
Expected: green.

- [ ] **Step 6: Commit (include the plan doc, currently untracked)**
```bash
git add src/extension/index.js src/extension/index.d.ts test/extension.test.js docs/extension-model.md docs/extension-model-plan-phase7b.md
git commit -m "feat(extension): export command-manifest loader; types; mark §8 7b done"
```

---

## Done When

- [ ] `registerCommandManifest(registry, manifest, {baseDir})` registers each `command` entry as a matcher-gated hook; `keyFor` keys `tool:before` on `route.harnessId` and every other event on `route.kind`; an absent matcher matches all; a non-matching entry passes through (`undefined`).
- [ ] Load-time validation is fail-loud (event+index in the message): non-object `hooks`/entry, non-array event value, missing/wrong `type` (agent → Phase 8 error), empty `command`, non-string or invalid-regex `matcher`; a realtime event surfaces the §3.5 rejection. An absent `hooks` key is a no-op.
- [ ] `loadCommandManifestFile(registry, path)` reads + parses + registers with `baseDir = dirname(path)`; a malformed JSON file throws. A `./`/`../`/absolute `command` resolves against `baseDir`; a bare name is left for PATH.
- [ ] Both functions exported from `./extension` with `.d.ts` types; `npm test` green, no hang; `npm run check` green.

## Follow-on (not this plan)
- **Phase 8:** agent runner (LLM response review) — the `type:"agent"` manifest entries 7b rejects.
