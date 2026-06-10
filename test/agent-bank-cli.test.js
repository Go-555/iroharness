import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBankRegistry } from "../src/agent-bank/registry.js";
import { runBankCommand } from "../src/agent-bank/cli.js";
import { seedHarnessRecipe } from "../src/agent-bank/seed.js";

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
  // B-1: origin authority is the seed manifest, so a builtin must be
  // registered through seed (frontmatter `source` claims are ignored).
  seedHarnessRecipe({
    root,
    id: "tax-v3",
    role: "helper",
    harness: { capabilities: [] },
    status: "staging",
  });
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

// Fix 2 (W-3): running the CLI is NOT owner approval. A minted recipe needs an
// explicit --owner-approve flag for its first promotion to active.
const passingRuns = (id) => [
  {
    harnessId: id,
    status: "completed",
    output: { qualityScore: 5 },
    updatedAt: "2026-06-01T00:00:00Z",
  },
  {
    harnessId: id,
    status: "completed",
    output: { qualityScore: 4 },
    updatedAt: "2026-06-02T00:00:00Z",
  },
  {
    harnessId: id,
    status: "completed",
    output: { qualityScore: 5 },
    updatedAt: "2026-06-03T00:00:00Z",
  },
];

const passingContext = {
  sandboxVerified: true,
  securityReview: { passed: true, by: "bantou" },
};

test("bank promote refuses a minted recipe without --owner-approve", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "minted-one", "minted");

  const result = runBankCommand({
    root,
    argv: ["promote", "minted-one"],
    projectOs: fakeProjectOs(passingRuns("minted-one")),
    promotionContext: passingContext,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /owner/i);
  assert.deepEqual(createBankRegistry({ root }).list("staging"), [
    "minted-one",
  ]);
});

test("bank promote promotes a minted recipe with --owner-approve", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "minted-one", "minted");

  const result = runBankCommand({
    root,
    argv: ["promote", "minted-one", "--owner-approve"],
    projectOs: fakeProjectOs(passingRuns("minted-one")),
    promotionContext: passingContext,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(createBankRegistry({ root }).list("active"), ["minted-one"]);
});

// B-1: origin authority lives in the seed manifest at the bank root, NOT in
// the recipe's own frontmatter. A staged recipe that self-declares
// `source: builtin-harness` is still treated as minted (fail-safe) unless the
// manifest lists it, so it cannot skip the owner-in-loop gate.
test("bank promote treats a self-declared builtin as minted (manifest is the authority)", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "impostor", "builtin-harness"); // self-claim only

  const result = runBankCommand({
    root,
    argv: ["promote", "impostor"],
    projectOs: fakeProjectOs(passingRuns("impostor")),
    promotionContext: passingContext,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /owner/i);
  assert.deepEqual(createBankRegistry({ root }).list("staging"), ["impostor"]);
});

test("bank promote allows a manifest-recorded (seeded) builtin without --owner-approve", () => {
  const root = makeBank();
  seedHarnessRecipe({
    root,
    id: "codex",
    role: "coder",
    harness: { capabilities: ["code"] },
    status: "staging",
  });

  const result = runBankCommand({
    root,
    argv: ["promote", "codex"],
    projectOs: fakeProjectOs(passingRuns("codex")),
    promotionContext: passingContext,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(createBankRegistry({ root }).list("active"), ["codex"]);
});

// Fix 3: an argv-supplied id is validated before it reaches the filesystem.
test("bank promote rejects a path-traversal id", () => {
  const root = makeBank();

  assert.throws(
    () =>
      runBankCommand({
        root,
        argv: ["promote", "../escape"],
        projectOs: fakeProjectOs([]),
      }),
    /invalid recipe id/i,
  );
});
