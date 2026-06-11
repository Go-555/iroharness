// A1: the default runner factory — the opt-in production wiring for the
// Hanaita's injected createRunner({ id, recipe }).
//
// Security posture under test:
// - the runtime allow-map is CODE-SIDE authority (codex / claude-code only);
//   a recipe's frontmatter can never select a command.
// - which runtime a recipe rides is decided from the seed manifest
//   (originOf: builtin ids map through the code-side builtinRuntimes map);
//   minted recipes run only when the OPERATOR opted in via mintedRuntime.
// - unit tests mock the spawn layer: codex gets a fake transport, claude-code
//   gets `command: process.execPath` + a stdin-echo script (same approach as
//   test/adapters.test.js). No real codex/claude binary is ever invoked.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createInMemoryProjectOs } from "../src/index.js";
import { createHanaita } from "../src/agent-bank/hanaita.js";
import {
  createDefaultRunnerFactory,
  DEFAULT_BUILTIN_RUNTIMES,
} from "../src/agent-bank/runner-factory.js";
import { seedHarnessRecipe } from "../src/agent-bank/seed.js";

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-factory-"));

const writeRecipe = (
  root,
  status,
  id,
  { toolset = ["doc-read"], body = `You are the ${id} specialist.` } = {},
) => {
  const dir = join(root, status, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "recipe.md"),
    [
      "---",
      `id: ${id}`,
      `role: ${id} specialist`,
      `toolset: [${toolset.join(", ")}]`,
      "---",
      "",
      body,
      "",
    ].join("\n"),
  );
};

// Same shape as test/adapters.test.js — records requests, emits a canned
// agent-message delta then turn/completed.
const createFakeCodexTransport = ({ reply = "fake codex reply" } = {}) => {
  let listeners = [];
  const requests = [];
  const emit = (event) => {
    listeners.forEach((listener) => listener(event));
  };
  let closed = false;
  return {
    requests,
    get closed() {
      return closed;
    },
    async initialize() {
      requests.push({ method: "initialize" });
    },
    async sendRequest(method, params) {
      requests.push({ method, params });
      if (method === "thread/start") {
        return { thread: { id: "thread_1" } };
      }
      if (method === "turn/start") {
        setTimeout(() => {
          emit({
            method: "item/agentMessage/delta",
            params: { delta: reply },
          });
          emit({ method: "turn/completed", params: { turn: { id: "t1" } } });
        }, 0);
        return { turn: { id: "t1" } };
      }
      return {};
    },
    subscribe(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((candidate) => candidate !== listener);
      };
    },
    close() {
      closed = true;
    },
  };
};

// A stdin-echo stand-in for the claude CLI: prints a JSON line whose summary
// embeds the prompt it received, so tests can assert on prompt dressing.
const writeFakeClaudeScript = (dir) => {
  const scriptPath = join(dir, "fake-claude.mjs");
  writeFileSync(
    scriptPath,
    [
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  console.log(JSON.stringify({",
      "    status: 'completed',",
      "    summary: `prompt:${input}`,",
      "    artifacts: []",
      "  }));",
      "});",
    ].join("\n"),
  );
  return scriptPath;
};

// ---- resolution: seed manifest is the mapping basis -------------------------

test("builtin codex recipe resolves to the codex app-server micro-harness", async () => {
  const root = makeBank();
  seedHarnessRecipe({
    root,
    id: "codex",
    role: "coding contractor",
    harness: { capabilities: ["code", "files", "review"] },
  });
  const transport = createFakeCodexTransport({ reply: "codex did it" });
  const createRunner = createDefaultRunnerFactory({
    root,
    cwd: "/tmp/project",
    runtimeOptions: { codex: { transport, timeoutMs: 1000 } },
  });

  const worker = createRunner({
    id: "codex",
    recipe: { id: "codex", role: "coding contractor", body: "" },
  });
  const output = await worker.run(
    { id: "t1", title: "smoke", purpose: "do the thing" },
    {},
  );

  assert.equal(output.status, "completed");
  assert.equal(output.summary, "codex did it");
  assert.equal(
    transport.requests.some((request) => request.method === "thread/start"),
    true,
  );
});

test("builtin claude-code recipe resolves to the claude-code CLI micro-harness", async () => {
  const root = makeBank();
  seedHarnessRecipe({
    root,
    id: "claude-code",
    role: "coding contractor",
    harness: { capabilities: ["code", "files", "review", "claude-code"] },
  });
  const scriptPath = writeFakeClaudeScript(makeBank());
  const createRunner = createDefaultRunnerFactory({
    root,
    runtimeOptions: {
      "claude-code": {
        command: process.execPath,
        args: [scriptPath],
        timeoutMs: 5000,
      },
    },
  });

  const worker = createRunner({
    id: "claude-code",
    recipe: { id: "claude-code", role: "coding contractor", body: "" },
  });
  const output = await worker.run(
    { id: "t2", title: "smoke", purpose: "review the README" },
    {},
  );

  assert.equal(output.status, "completed");
  assert.match(output.summary, /review the README/);
});

// ---- fail-closed: no approved runtime, no runner ----------------------------

test("a minted recipe is refused unless the operator opted into mintedRuntime", () => {
  const root = makeBank();
  writeRecipe(root, "active", "tax-helper");
  const createRunner = createDefaultRunnerFactory({ root });

  assert.throws(
    () =>
      createRunner({
        id: "tax-helper",
        recipe: { id: "tax-helper", role: "tax", body: "" },
      }),
    /runner_unavailable/,
  );
});

test("a recipe spoofing a builtin id without a manifest entry is refused", () => {
  // The recipe folder claims the id "codex" but the seed manifest does not
  // list it: origin is "minted" (fail-safe) and no runtime resolves.
  const root = makeBank();
  writeRecipe(root, "active", "codex");
  const createRunner = createDefaultRunnerFactory({ root });

  assert.throws(
    () => createRunner({ id: "codex", recipe: { id: "codex", role: "x" } }),
    /runner_unavailable/,
  );
});

test("frontmatter cannot select a runtime or a command", () => {
  // Even if a minted recipe self-declares runtime/command fields, the factory
  // never reads them: with no operator opt-in the hire is refused.
  const root = makeBank();
  writeRecipe(root, "active", "sneaky");
  const createRunner = createDefaultRunnerFactory({ root });

  assert.throws(
    () =>
      createRunner({
        id: "sneaky",
        recipe: {
          id: "sneaky",
          role: "sneaky",
          runtime: "codex",
          command: "/bin/evil",
          body: "",
        },
      }),
    /runner_unavailable/,
  );
});

test("mintedRuntime must name a key in the code-side allow map", () => {
  const root = makeBank();
  assert.throws(
    () => createDefaultRunnerFactory({ root, mintedRuntime: "evil-shell" }),
    /mintedRuntime/,
  );
});

test("the factory requires the bank root (origin authority)", () => {
  assert.throws(() => createDefaultRunnerFactory({}), /root/);
});

// ---- minted opt-in + prompt dressing ----------------------------------------

test("a minted recipe rides the opted-in runtime and is dressed in its recipe", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "tax-helper", {
    body: "Classify expenses by Japanese tax category.",
  });
  const scriptPath = writeFakeClaudeScript(makeBank());
  const createRunner = createDefaultRunnerFactory({
    root,
    mintedRuntime: "claude-code",
    runtimeOptions: {
      "claude-code": {
        command: process.execPath,
        args: [scriptPath],
        timeoutMs: 5000,
      },
    },
  });

  const worker = createRunner({
    id: "tax-helper",
    recipe: {
      id: "tax-helper",
      role: "tax specialist",
      body: "Classify expenses by Japanese tax category.",
    },
  });
  const output = await worker.run(
    { id: "t3", title: "classify", purpose: "classify these receipts" },
    {},
  );

  assert.equal(output.status, "completed");
  // The specialist prompt carries the recipe role + body AND the task.
  assert.match(output.summary, /tax specialist/);
  assert.match(output.summary, /Classify expenses by Japanese tax category/);
  assert.match(output.summary, /classify these receipts/);
});

// ---- lifecycle ---------------------------------------------------------------

test("factory.close() closes every runner it created", async () => {
  const root = makeBank();
  seedHarnessRecipe({
    root,
    id: "codex",
    role: "coding contractor",
    harness: { capabilities: ["code"] },
  });
  const transport = createFakeCodexTransport();
  const createRunner = createDefaultRunnerFactory({
    root,
    runtimeOptions: { codex: { transport, timeoutMs: 1000 } },
  });

  const worker = createRunner({
    id: "codex",
    recipe: { id: "codex", role: "coding contractor", body: "" },
  });
  await worker.run({ id: "t4", title: "smoke", purpose: "ping" }, {});
  assert.equal(transport.closed, false);

  createRunner.close();
  assert.equal(transport.closed, true);
});

// ---- end-to-end through the Hanaita (fake transport, real wiring) ------------

test("the Hanaita runs a goal on the default factory (codex, fake transport)", async () => {
  const root = makeBank();
  seedHarnessRecipe({
    root,
    id: "codex",
    role: "coding contractor",
    harness: { capabilities: ["code", "files", "review"] },
  });
  const workspace = mkdtempSync(join(tmpdir(), "factory-ws-"));
  const transport = createFakeCodexTransport({ reply: "wired through" });
  const projectOs = createInMemoryProjectOs();
  const hanaita = createHanaita({
    root,
    projectOs,
    workRunnerPolicy: {
      kind: "iroharness.workRunnerPolicy",
      zone: "owner",
      delegation: "allowed",
      boundary: "runner-only",
      runnerAccess: {
        repositoryWork: "scoped-workspace",
        browserControl: "scoped-session",
        defaultSandbox: "workspace-write",
      },
    },
    allowedWorkspaces: [workspace],
    defaultWorkspace: workspace,
    createRunner: createDefaultRunnerFactory({
      root,
      cwd: workspace,
      runtimeOptions: { codex: { transport, timeoutMs: 1000 } },
    }),
  });

  const handle = hanaita.delegateGoal({
    title: "wire it",
    steps: [{ id: "s1", recipe: "codex", slice: "confirm the wiring" }],
  });
  const result = await handle.summary;

  assert.equal(result.status, "completed");
  assert.match(result.summary, /wired through/);
  const snapshot = projectOs.snapshot();
  assert.equal(snapshot.runs.length, 1);
  assert.equal(snapshot.runs[0].harnessId, "codex");
  assert.equal(snapshot.runs[0].status, "completed");
});

test("DEFAULT_BUILTIN_RUNTIMES maps exactly the two approved runtimes", () => {
  assert.deepEqual(DEFAULT_BUILTIN_RUNTIMES, {
    codex: "codex",
    "claude-code": "claude-code",
  });
});

// ---- H-1: the smoke isolation is wired to the RUNTIME boundary ---------------
// The trial workspace must be the runner's actual execution boundary: the
// codex thread/turn cwd and sandboxPolicy.writableRoots point at the trial
// workspace, NOT at the factory's construction-time cwd.

test("the smoke trial runs the runner with the trial workspace as cwd/writableRoots", async () => {
  const { createSmokeTrial, runSandboxVerification } =
    await import("../src/agent-bank/sandbox.js");
  const root = makeBank();
  seedHarnessRecipe({
    root,
    id: "codex",
    role: "coding contractor",
    harness: { capabilities: ["code", "files", "review"] },
  });
  const transport = createFakeCodexTransport({ reply: "OK" });
  const factoryCwd = mkdtempSync(join(tmpdir(), "factory-cwd-"));
  const createRunner = createDefaultRunnerFactory({
    root,
    cwd: factoryCwd, // construction-time cwd — must NOT leak into the smoke
    runtimeOptions: { codex: { transport, timeoutMs: 1000 } },
  });

  const runTrial = createSmokeTrial({ createRunner });
  const result = await runSandboxVerification({ root, id: "codex", runTrial });
  assert.equal(result.verified, true);

  const threadStart = transport.requests.find(
    (request) => request.method === "thread/start",
  );
  const turnStart = transport.requests.find(
    (request) => request.method === "turn/start",
  );
  // negative: the factory construction cwd is NOT the execution boundary
  assert.notEqual(threadStart.params.cwd, factoryCwd);
  assert.notEqual(turnStart.params.cwd, factoryCwd);
  // positive: the isolated trial workspace IS the execution boundary
  assert.match(threadStart.params.cwd, /iroharness-smoke-/);
  assert.match(turnStart.params.cwd, /iroharness-smoke-/);
  assert.deepEqual(turnStart.params.sandboxPolicy.writableRoots, [
    turnStart.params.cwd,
  ]);
  assert.match(
    turnStart.params.sandboxPolicy.writableRoots[0],
    /iroharness-smoke-/,
  );
});
