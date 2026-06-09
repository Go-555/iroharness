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
