import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runBankCommand } from "../src/agent-bank/cli.js";
import { evaluatePromotion } from "../src/agent-bank/promotion.js";
import { createBankRegistry } from "../src/agent-bank/registry.js";
import {
  isSandboxVerified,
  lookupSandboxVerification,
  runSandboxVerification,
} from "../src/agent-bank/sandbox.js";

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-sandbox-"));

const writeRecipe = (root, status, id) => {
  const dir = join(root, status, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "recipe.md"),
    ["---", `id: ${id}`, "role: helper", "---", "", "body", ""].join("\n"),
  );
};

// ---- the authoritative record (verification-ledger.json at the bank root) ----

test("a passing trial is recorded in verification-ledger.json at the bank root", async () => {
  const root = makeBank();
  writeRecipe(root, "staging", "fresh");

  const result = await runSandboxVerification({
    root,
    id: "fresh",
    runTrial: async ({ recipe }) => {
      assert.equal(recipe.id, "fresh"); // the trial receives the parsed recipe
      return { passed: true };
    },
  });

  assert.deepEqual(result, { id: "fresh", verified: true });
  // the record lives OUTSIDE any recipe folder — frontmatter can never taint it
  const ledgerFile = join(root, "verification-ledger.json");
  assert.equal(existsSync(ledgerFile), true);
  const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
  assert.equal(ledger.recipes.fresh.verified, true);
  assert.equal(isSandboxVerified({ root, id: "fresh" }), true);
});

test("a failing trial is recorded as verified:false (overwrites a stale pass)", async () => {
  const root = makeBank();
  writeRecipe(root, "staging", "flaky");

  await runSandboxVerification({
    root,
    id: "flaky",
    runTrial: () => ({ passed: true }),
  });
  assert.equal(isSandboxVerified({ root, id: "flaky" }), true);

  const result = await runSandboxVerification({
    root,
    id: "flaky",
    runTrial: () => ({ passed: false }),
  });
  assert.deepEqual(result, { id: "flaky", verified: false });
  assert.equal(isSandboxVerified({ root, id: "flaky" }), false);
  assert.equal(
    lookupSandboxVerification({ root, id: "flaky" }).verified,
    false,
  );
});

test("a trial outcome that is not exactly passed:true records as unverified (fail-safe)", async () => {
  const root = makeBank();
  writeRecipe(root, "staging", "vague");

  const result = await runSandboxVerification({
    root,
    id: "vague",
    runTrial: () => ({ passed: "yes" }), // truthy but not true
  });
  assert.equal(result.verified, false);
  assert.equal(isSandboxVerified({ root, id: "vague" }), false);
});

test("runSandboxVerification refuses an unknown recipe and a traversal id", async () => {
  const root = makeBank();
  await assert.rejects(
    () => runSandboxVerification({ root, id: "ghost", runTrial: () => ({}) }),
    /not found/,
  );
  await assert.rejects(
    () =>
      runSandboxVerification({ root, id: "../escape", runTrial: () => ({}) }),
    /invalid recipe id/i,
  );
});

test("the verification ledger reader is fail-safe", () => {
  const root = makeBank();
  // missing file -> unverified
  assert.equal(isSandboxVerified({ root, id: "anything" }), false);
  // garbage JSON -> unverified
  writeFileSync(join(root, "verification-ledger.json"), "{nope");
  assert.equal(isSandboxVerified({ root, id: "anything" }), false);
  // tainted entries (invalid id, non-boolean verified) are dropped
  writeFileSync(
    join(root, "verification-ledger.json"),
    JSON.stringify({
      recipes: {
        "../escape": { verified: true },
        loose: { verified: "true" },
        good: { verified: true },
      },
    }),
  );
  assert.equal(lookupSandboxVerification({ root, id: "loose" }), null);
  assert.equal(isSandboxVerified({ root, id: "good" }), true);
});

// ---- evaluatePromotion derives sandboxVerified from the record (mekiki) ----

const passingInputs = (recipeId) => ({
  recipeId,
  ledgerEntry: { calls: 3, success: 3, avgScore: 4.6 },
  securityReview: { passed: true, by: "bantou" },
  origin: "builtin",
});

test("with a bank root, a recorded pass overrides a false self-report", async () => {
  const root = makeBank();
  writeRecipe(root, "staging", "proven");
  await runSandboxVerification({
    root,
    id: "proven",
    runTrial: () => ({ passed: true }),
  });

  const verdict = evaluatePromotion({
    ...passingInputs("proven"),
    root,
    sandboxVerified: false, // ignored: the record is the authority
  });
  assert.equal(verdict.promote, true);
});

// THE mekiki closure: promotionContext used to be pure self-report. With the
// bank root supplied, a recorded FAILED trial defeats a lying caller.
test("with a bank root, a recorded failure defeats a lying self-report", async () => {
  const root = makeBank();
  writeRecipe(root, "staging", "liar");
  await runSandboxVerification({
    root,
    id: "liar",
    runTrial: () => ({ passed: false }),
  });

  const verdict = evaluatePromotion({
    ...passingInputs("liar"),
    root,
    sandboxVerified: true, // self-report, defeated by the record
  });
  assert.equal(verdict.promote, false);
  assert.match(verdict.reasons.join(" "), /sandbox/i);
});

// DoD 3.3: an unverified recipe cannot be promoted to active.
test("with a bank root and no record, an unverified recipe stays blocked", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "untried");

  const verdict = evaluatePromotion({
    ...passingInputs("untried"),
    root,
    // no record, no self-report -> not sandbox-verified
  });
  assert.equal(verdict.promote, false);
  assert.match(verdict.reasons.join(" "), /sandbox/i);
});

// Compat: without a root, the legacy self-report path still works (existing
// callers/tests), and absent both record and claim the gate stays closed.
test("without a bank root, the legacy self-report path is unchanged", () => {
  assert.equal(
    evaluatePromotion({ ...passingInputs("legacy"), sandboxVerified: true })
      .promote,
    true,
  );
  assert.equal(
    evaluatePromotion({ ...passingInputs("legacy") }).promote,
    false,
  );
});

// ---- CLI wiring: bank promote consults the record ----

const passingRuns = (id) =>
  ["2026-06-01", "2026-06-02", "2026-06-03"].map((day) => ({
    harnessId: id,
    status: "completed",
    output: { qualityScore: 5 },
    updatedAt: `${day}T00:00:00Z`,
  }));

const fakeProjectOs = (runs) => ({ snapshot: () => ({ runs, artifacts: [] }) });

test("bank promote refuses a recipe whose recorded sandbox trial failed, even with a self-reported pass", async () => {
  const root = makeBank();
  writeRecipe(root, "staging", "smooth-talker");
  await runSandboxVerification({
    root,
    id: "smooth-talker",
    runTrial: () => ({ passed: false }),
  });

  const result = runBankCommand({
    root,
    argv: ["promote", "smooth-talker", "--owner-approve"],
    projectOs: fakeProjectOs(passingRuns("smooth-talker")),
    promotionContext: {
      sandboxVerified: true, // self-report — must lose to the record
      securityReview: { passed: true, by: "bantou" },
    },
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /sandbox/i);
  assert.deepEqual(createBankRegistry({ root }).list("staging"), [
    "smooth-talker",
  ]);
});

test("bank promote accepts a recorded sandbox pass without any self-report", async () => {
  const root = makeBank();
  writeRecipe(root, "staging", "earned-it");
  await runSandboxVerification({
    root,
    id: "earned-it",
    runTrial: () => ({ passed: true }),
  });

  const result = runBankCommand({
    root,
    argv: ["promote", "earned-it", "--owner-approve"],
    projectOs: fakeProjectOs(passingRuns("earned-it")),
    promotionContext: {
      securityReview: { passed: true, by: "bantou" },
      // no sandboxVerified claim: the record alone satisfies the gate
    },
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(createBankRegistry({ root }).list("active"), ["earned-it"]);
});
