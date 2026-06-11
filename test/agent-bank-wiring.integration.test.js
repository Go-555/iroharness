// Real-runtime integration for the Agent Bank wiring (A1 + A3).
//
// These tests start REAL runtimes (codex app-server / claude CLI), so they
// are env-gated and never run in CI or a plain `npm test`:
//
//   IROHARNESS_CODEX_INTEGRATION=1       npm test   # codex (needs `codex login`)
//   IROHARNESS_CLAUDE_CODE_INTEGRATION=1 npm test   # claude CLI (needs auth)
//
// When the gate is unset the tests SKIP with a visible reason — the unit
// suite stays portable (same posture as beads-project-os.integration.test.js).

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDefaultRunnerFactory } from "../src/agent-bank/runner-factory.js";
import {
  createSmokeTrial,
  isSandboxVerified,
  runSandboxVerification,
} from "../src/agent-bank/sandbox.js";
import { seedHarnessRecipe } from "../src/agent-bank/seed.js";

const codexEnabled = process.env.IROHARNESS_CODEX_INTEGRATION === "1";
const claudeEnabled = process.env.IROHARNESS_CLAUDE_CODE_INTEGRATION === "1";

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-it-"));

const smokeAgainstRealRuntime = async ({ id, capabilities }) => {
  const root = makeBank();
  seedHarnessRecipe({
    root,
    id,
    role: `${id} contractor`,
    harness: { capabilities },
  });
  const workspace = mkdtempSync(join(tmpdir(), "agent-bank-it-ws-"));
  const createRunner = createDefaultRunnerFactory({ root, cwd: workspace });
  try {
    const runTrial = createSmokeTrial({
      createRunner,
      workspace,
      timeoutMs: 180_000,
    });
    const result = await runSandboxVerification({ root, id, runTrial });
    assert.equal(result.verified, true, "real runtime smoke should pass");
    assert.equal(isSandboxVerified({ root, id }), true);
  } finally {
    createRunner.close();
  }
};

test(
  "real codex: default factory + smoke trial records verified:true",
  {
    skip: codexEnabled
      ? false
      : "set IROHARNESS_CODEX_INTEGRATION=1 to run (needs codex login)",
    timeout: 240_000,
  },
  async () => {
    await smokeAgainstRealRuntime({
      id: "codex",
      capabilities: ["code", "files", "review"],
    });
  },
);

test(
  "real claude-code: default factory + smoke trial records verified:true",
  {
    skip: claudeEnabled
      ? false
      : "set IROHARNESS_CLAUDE_CODE_INTEGRATION=1 to run (needs claude auth)",
    timeout: 240_000,
  },
  async () => {
    await smokeAgainstRealRuntime({
      id: "claude-code",
      capabilities: ["code", "files", "review", "claude-code"],
    });
  },
);
