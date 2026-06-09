import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createHookRegistry } from "../src/extension/hook-registry.js";
import {
  registerCommandManifest,
  keyFor,
} from "../src/extension/hook-runners/manifest.js";

const HOOKS_DIR = dirname(
  fileURLToPath(new URL("./fixtures/hooks/allow.mjs", import.meta.url)),
);

test("keyFor uses route.harnessId for tool:before", () => {
  assert.equal(
    keyFor("tool:before", { route: { harnessId: "codex", kind: "work" } }),
    "codex",
  );
});
test("keyFor uses route.kind for other events", () => {
  assert.equal(keyFor("turn:before", { route: { kind: "stream" } }), "stream");
});
test("keyFor falls back to empty string when route/field absent", () => {
  assert.equal(keyFor("tool:before", {}), "");
  assert.equal(keyFor("turn:before", { route: {} }), "");
});

const manifestWith = (matcher) => ({
  hooks: {
    "turn:before": [
      {
        type: "command",
        matcher,
        command: process.execPath,
        args: [`${HOOKS_DIR}/allow.mjs`],
      },
    ],
  },
});

test("a matcher that matches route.kind runs the hook", async () => {
  const registry = createHookRegistry();
  registerCommandManifest(registry, manifestWith("stream"), {
    baseDir: HOOKS_DIR,
  });
  const r = await registry.dispatch("turn:before", {
    route: { kind: "stream" },
    input: { text: "x" },
  });
  assert.equal(r.blocked, false);
  assert.equal(r.context.marker, "ran");
});

test("a matcher that does NOT match the route.kind skips the hook", async () => {
  const registry = createHookRegistry();
  registerCommandManifest(registry, manifestWith("voice"), {
    baseDir: HOOKS_DIR,
  });
  const r = await registry.dispatch("turn:before", {
    route: { kind: "stream" },
    input: { text: "x" },
  });
  assert.equal(r.blocked, false);
  assert.equal(r.context.marker, undefined);
});

test("an absent matcher matches everything", async () => {
  const registry = createHookRegistry();
  registerCommandManifest(
    registry,
    {
      hooks: {
        "turn:before": [
          {
            type: "command",
            command: process.execPath,
            args: [`${HOOKS_DIR}/allow.mjs`],
          },
        ],
      },
    },
    { baseDir: HOOKS_DIR },
  );
  const r = await registry.dispatch("turn:before", {
    route: { kind: "anything" },
    input: { text: "x" },
  });
  assert.equal(r.context.marker, "ran");
});

// ─── Task 2: fail-loud load-time validation ───────────────────────────────────

const reg = () => createHookRegistry();
const load = (manifest) =>
  registerCommandManifest(reg(), manifest, { baseDir: HOOKS_DIR });
const cmd = (extra) => ({
  type: "command",
  command: process.execPath,
  args: [`${HOOKS_DIR}/allow.mjs`],
  ...extra,
});

test("an absent hooks key is a no-op (not an error)", () => {
  assert.doesNotThrow(() =>
    registerCommandManifest(reg(), {}, { baseDir: HOOKS_DIR }),
  );
});
test("hooks must be an object", () => {
  assert.throws(() => load({ hooks: [] }), /hooks/);
});
test("an event value must be an array", () => {
  assert.throws(() => load({ hooks: { "turn:before": {} } }), /turn:before/);
});
test("a non-object entry throws naming event+index", () => {
  assert.throws(
    () => load({ hooks: { "turn:before": ["nope"] } }),
    /turn:before.*\b0\b/,
  );
});
test("type is required and must be command", () => {
  assert.throws(
    () => load({ hooks: { "turn:before": [{ command: "x" }] } }),
    /type/,
  );
});
test("type agent is a Phase 8 load error", () => {
  assert.throws(
    () =>
      load({ hooks: { "response:before": [{ type: "agent", prompt: "x" }] } }),
    /agent/i,
  );
});
test("command must be a non-empty string", () => {
  assert.throws(
    () =>
      load({ hooks: { "turn:before": [{ type: "command", command: "" }] } }),
    /command/,
  );
});
test("a non-string matcher throws", () => {
  assert.throws(
    () => load({ hooks: { "turn:before": [cmd({ matcher: 42 })] } }),
    /matcher/,
  );
});
test("an invalid regex matcher throws naming event+index", () => {
  assert.throws(
    () => load({ hooks: { "turn:before": [cmd({ matcher: "(" })] } }),
    /turn:before.*\b0\b/,
  );
});
test("a command hook on a realtime event is rejected (realtime invariant)", () => {
  assert.throws(
    () => load({ hooks: { "bargein:detect": [cmd()] } }),
    /realtime/,
  );
});
