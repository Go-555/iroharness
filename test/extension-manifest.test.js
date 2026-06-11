import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHookRegistry } from "../src/extension/hook-registry.js";
import {
  registerCommandManifest,
  keyFor,
  resolveCommand,
  loadCommandManifestFile,
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
// ─── Phase 8: type "agent" unlocked ───────────────────────────────────────────

const agentVerdictBrain = (verdict) => ({
  id: "manifest-judge",
  calls: [],
  async respond(context) {
    this.calls.push(context);
    return { text: JSON.stringify(verdict) };
  },
});

const captureWarnings = (run) => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    run();
  } finally {
    console.warn = original;
  }
  return warnings;
};

test("loading agent entries without a judgeBrain warns once that the gate is inert", () => {
  const warnings = captureWarnings(() => {
    registerCommandManifest(
      reg(),
      {
        hooks: {
          "response:before": [
            { type: "agent", prompt: "p" },
            { type: "agent", prompt: "q" },
          ],
        },
      },
      { baseDir: HOOKS_DIR },
    );
  });
  const hits = warnings.filter((message) => /judgeBrain/.test(message));
  assert.equal(hits.length, 1); // once per load, not once per entry
  assert.match(hits[0], /inert/);
});

test("no inert-gate warning when a judgeBrain is injected or no agent entries exist", () => {
  const withBrain = captureWarnings(() => {
    registerCommandManifest(
      reg(),
      { hooks: { "response:before": [{ type: "agent", prompt: "p" }] } },
      { baseDir: HOOKS_DIR, judgeBrain: agentVerdictBrain({ ok: true }) },
    );
  });
  const commandOnly = captureWarnings(() => {
    registerCommandManifest(
      reg(),
      { hooks: { "turn:before": [cmd()] } },
      { baseDir: HOOKS_DIR },
    );
  });
  assert.equal(withBrain.filter((m) => /judgeBrain/.test(m)).length, 0);
  assert.equal(commandOnly.filter((m) => /judgeBrain/.test(m)).length, 0);
});

test("an agent entry registers and a deny verdict blocks when a judgeBrain is injected", async () => {
  const registry = createHookRegistry();
  const judgeBrain = agentVerdictBrain({ ok: false, reasons: ["broke"] });
  registerCommandManifest(
    registry,
    {
      hooks: {
        "response:before": [
          { type: "agent", prompt: "Is this in character?", timeout: 5000 },
        ],
      },
    },
    { baseDir: HOOKS_DIR, judgeBrain },
  );
  const r = await registry.dispatch("response:before", {
    route: { kind: "text" },
    input: { text: "q" },
    response: { text: "私はそう思います。" },
  });
  assert.equal(r.blocked, true);
  assert.equal(r.reason, "broke");
  assert.equal(judgeBrain.calls.length, 1);
});

test("a manifest-declared agent hook without an injected judgeBrain fires fail-open (no LLM is connected by declaration alone)", async () => {
  const registry = createHookRegistry();
  registerCommandManifest(
    registry,
    { hooks: { "response:before": [{ type: "agent", prompt: "judge" }] } },
    { baseDir: HOOKS_DIR },
  );
  const r = await registry.dispatch("response:before", {
    route: { kind: "text" },
    response: { text: "anything" },
  });
  assert.equal(r.blocked, false); // fail-open default: the face is never muted
});

test("an agent entry honors its matcher (route.kind key)", async () => {
  const registry = createHookRegistry();
  const judgeBrain = agentVerdictBrain({ ok: false, reasons: ["broke"] });
  registerCommandManifest(
    registry,
    {
      hooks: {
        "response:before": [{ type: "agent", prompt: "p", matcher: "deep" }],
      },
    },
    { baseDir: HOOKS_DIR, judgeBrain },
  );
  const text = await registry.dispatch("response:before", {
    route: { kind: "text" },
    response: { text: "x" },
  });
  assert.equal(text.blocked, false); // matcher "deep" skips kind "text"
  assert.equal(judgeBrain.calls.length, 0);
  const deep = await registry.dispatch("response:before", {
    route: { kind: "deep" },
    response: { text: "x" },
  });
  assert.equal(deep.blocked, true);
});

test("an agent entry without a prompt throws naming event+index", () => {
  assert.throws(
    () => load({ hooks: { "response:before": [{ type: "agent" }] } }),
    /response:before.*\b0\b.*prompt/,
  );
  assert.throws(
    () =>
      load({ hooks: { "response:before": [{ type: "agent", prompt: "" }] } }),
    /prompt/,
  );
});

test("an agent entry with a non-string model throws", () => {
  assert.throws(
    () =>
      load({
        hooks: {
          "response:before": [{ type: "agent", prompt: "p", model: 42 }],
        },
      }),
    /model/,
  );
});

test("an agent entry with a non-number timeout throws", () => {
  assert.throws(
    () =>
      load({
        hooks: {
          "response:before": [{ type: "agent", prompt: "p", timeout: "slow" }],
        },
      }),
    /timeout/,
  );
});

test("an agent hook on a realtime event is rejected at load (realtime invariant)", () => {
  for (const event of ["bargein:detect", "speech:before", "device:emit"]) {
    assert.throws(
      () => load({ hooks: { [event]: [{ type: "agent", prompt: "p" }] } }),
      /realtime/,
    );
  }
});

test("a malformed agent entry is atomic: a valid command entry before it registers zero hooks", async () => {
  const registry = createHookRegistry();
  assert.throws(
    () =>
      registerCommandManifest(
        registry,
        {
          hooks: {
            "turn:before": [cmd()],
            "response:before": [{ type: "agent" }],
          },
        },
        { baseDir: HOOKS_DIR },
      ),
    /prompt/,
  );
  const r = await registry.dispatch("turn:before", {
    route: { kind: "x" },
    input: { text: "x" },
  });
  assert.equal(r.context.marker, undefined);
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

test("a malformed manifest registers ZERO hooks (atomic load)", async () => {
  const registry = createHookRegistry();
  // A valid entry precedes an invalid one in the same event array.
  assert.throws(
    () =>
      registerCommandManifest(
        registry,
        {
          hooks: {
            "turn:before": [cmd(), { type: "command", command: "" }],
          },
        },
        { baseDir: HOOKS_DIR },
      ),
    /command/,
  );
  // The valid first hook must NOT have been registered (pass 1 threw first).
  const r = await registry.dispatch("turn:before", {
    route: { kind: "x" },
    input: { text: "x" },
  });
  assert.equal(r.blocked, false);
  assert.equal(r.context.marker, undefined);
});

test("bad args is atomic: valid entry before non-string args registers zero hooks", async () => {
  const registry = createHookRegistry();
  assert.throws(
    () =>
      registerCommandManifest(
        registry,
        {
          hooks: {
            "turn:before": [
              cmd(),
              { type: "command", command: process.execPath, args: [123] },
            ],
          },
        },
        { baseDir: HOOKS_DIR },
      ),
    /args/,
  );
  const r = await registry.dispatch("turn:before", {
    route: { kind: "x" },
    input: { text: "x" },
  });
  assert.equal(r.blocked, false);
  assert.equal(r.context.marker, undefined);
});

test("an empty-string event key throws (non-empty event required)", () => {
  assert.throws(() => load({ hooks: { "": [cmd()] } }), /non-empty/);
});

// Optional fields are type-validated at the load boundary (so a bad value fails
// loud here, not as a coercion/throw later at spawn; honors the .d.ts contract).
test("a non-number timeout throws", () => {
  assert.throws(
    () => load({ hooks: { "turn:before": [cmd({ timeout: "slow" })] } }),
    /timeout/,
  );
});
test("a non-string cwd throws", () => {
  assert.throws(
    () => load({ hooks: { "turn:before": [cmd({ cwd: 123 })] } }),
    /cwd/,
  );
});
test("a non-object env throws", () => {
  assert.throws(
    () => load({ hooks: { "turn:before": [cmd({ env: "PATH=/bin" })] } }),
    /env/,
  );
});
test("an env with a non-string value throws naming the key", () => {
  assert.throws(
    () => load({ hooks: { "turn:before": [cmd({ env: { PATH: 1 } })] } }),
    /env\["PATH"\]/,
  );
});
test("a non-number priority throws (would otherwise poison register's sort)", () => {
  assert.throws(
    () => load({ hooks: { "turn:before": [cmd({ priority: "high" })] } }),
    /priority/,
  );
});
test("a bad optional field is atomic: a valid entry before it registers zero hooks", async () => {
  const registry = createHookRegistry();
  assert.throws(
    () =>
      registerCommandManifest(
        registry,
        { hooks: { "turn:before": [cmd(), cmd({ priority: "high" })] } },
        { baseDir: HOOKS_DIR },
      ),
    /priority/,
  );
  const r = await registry.dispatch("turn:before", {
    route: { kind: "x" },
    input: { text: "y" },
  });
  assert.equal(r.blocked, false);
  assert.equal(r.context.marker, undefined); // the valid first entry was never registered
});

// ─── Task 3: resolveCommand + loadCommandManifestFile ─────────────────────────

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
  const MANIFEST = fileURLToPath(
    new URL("./fixtures/manifests/basic.json", import.meta.url),
  );
  const registry = createHookRegistry();
  loadCommandManifestFile(registry, MANIFEST);
  const r = await registry.dispatch("turn:before", {
    route: { kind: "x" },
    input: { text: "y" },
  });
  assert.equal(r.blocked, false);
  assert.equal(r.context.marker, "ran");
});

test("a malformed JSON manifest file throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroha-manifest-"));
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{ not json");
  const registry = createHookRegistry();
  assert.throws(() => loadCommandManifestFile(registry, bad), /parse|JSON/i);
});
