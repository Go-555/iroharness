import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBankRegistry } from "../src/agent-bank/registry.js";
import { runBankCommand } from "../src/agent-bank/cli.js";

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-cli-"));

const writeRecipe = (root, status, id, source = "builtin-harness") => {
  const dir = join(root, status, id);
  mkdirSync(dir, { recursive: true });
  const md = [
    "---",
    `id: ${id}`,
    "role: helper",
    `source: ${source}`,
    "---",
    "",
    "body",
    "",
  ].join("\n");
  writeFileSync(join(dir, "recipe.md"), md);
};

// A fake Project OS snapshot source for ledger derivation.
const fakeProjectOs = (runs) => ({ snapshot: () => ({ runs, artifacts: [] }) });

test("bank list renders the registry index", () => {
  const root = makeBank();
  writeRecipe(root, "active", "tax-v3");
  writeRecipe(root, "staging", "ma-v1");

  const result = runBankCommand({
    root,
    argv: ["list"],
    projectOs: fakeProjectOs([]),
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /tax-v3/);
  assert.match(result.output, /ma-v1/);
});

test("bank promote refuses when the composite gate is not satisfied", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "weak");
  const projectOs = fakeProjectOs([
    {
      harnessId: "weak",
      status: "failed",
      output: null,
      updatedAt: "2026-06-01T00:00:00Z",
    },
  ]);

  const result = runBankCommand({ root, argv: ["promote", "weak"], projectOs });

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /not promoted|blocked|rejected/i);
  // still in staging
  assert.deepEqual(createBankRegistry({ root }).list("staging"), ["weak"]);
});

test("bank promote moves a recipe to active when the gate passes", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "tax-v3");
  const runs = [
    {
      harnessId: "tax-v3",
      status: "completed",
      output: { qualityScore: 5 },
      updatedAt: "2026-06-01T00:00:00Z",
    },
    {
      harnessId: "tax-v3",
      status: "completed",
      output: { qualityScore: 4 },
      updatedAt: "2026-06-02T00:00:00Z",
    },
    {
      harnessId: "tax-v3",
      status: "completed",
      output: { qualityScore: 5 },
      updatedAt: "2026-06-03T00:00:00Z",
    },
  ];

  const result = runBankCommand({
    root,
    argv: ["promote", "tax-v3"],
    projectOs: fakeProjectOs(runs),
    promotionContext: {
      sandboxVerified: true,
      securityReview: { passed: true, by: "bantou" },
    },
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /promoted/i);
  assert.deepEqual(createBankRegistry({ root }).list("active"), ["tax-v3"]);
});
