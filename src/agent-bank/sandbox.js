// Sandbox verification (Phase 3.3) with an AUTHORITATIVE record.
// `runTrial` is injected (an isolated Work Runner trial in production, a stub
// in tests) and its outcome is written to `verification-ledger.json` at the
// bank root — outside any recipe folder, like seed-manifest.json, so a
// recipe's frontmatter can never taint it. evaluatePromotion derives its
// sandbox-verified condition from this record when given the bank root,
// closing the "promotionContext is self-reported" gap (mekiki): a recorded
// outcome always beats a caller's claim.
//
// Fail-safe reader, same posture as the seed manifest: a missing or
// unparsable ledger verifies nothing, and tainted entries (invalid id keys,
// non-boolean `verified`) are dropped so they can never satisfy the gate.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createScopedWorkRunnerMicroHarness } from "../adapters/index.js";

import { assertValidRecipeId, BANK_STATUSES } from "./ids.js";
import { parseRecipe } from "./recipe.js";

const VERIFICATION_LEDGER_FILE = "verification-ledger.json";

const ledgerPath = (root) => join(root, VERIFICATION_LEDGER_FILE);

const isValidRecipeId = (id) => {
  try {
    assertValidRecipeId(id);
    return true;
  } catch {
    return false;
  }
};

const readVerificationLedger = (root) => {
  const file = ledgerPath(root);
  if (!existsSync(file)) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  const recipes =
    parsed?.recipes && typeof parsed.recipes === "object" ? parsed.recipes : {};
  const clean = {};
  for (const [id, entry] of Object.entries(recipes)) {
    if (!isValidRecipeId(id)) {
      continue; // tainted key: drop, never grant
    }
    if (typeof entry?.verified !== "boolean") {
      continue; // tainted entry: drop, never grant
    }
    clean[id] = entry;
  }
  return clean;
};

const writeVerificationLedger = (root, recipes) => {
  writeFileSync(ledgerPath(root), `${JSON.stringify({ recipes }, null, 2)}\n`);
};

// The single read point for the authority record. null = never recorded.
export const lookupSandboxVerification = ({ root, id }) => {
  assertValidRecipeId(id);
  return readVerificationLedger(root)[id] ?? null;
};

export const isSandboxVerified = ({ root, id }) =>
  lookupSandboxVerification({ root, id })?.verified === true;

// Run the isolated trial and record its outcome. Only an outcome of exactly
// { passed: true } records as verified (fail-safe); anything else records
// verified:false, overwriting any stale pass.
export const runSandboxVerification = async ({
  root,
  id,
  runTrial,
  now = () => new Date().toISOString(),
}) => {
  assertValidRecipeId(id);
  if (typeof runTrial !== "function") {
    throw new Error(
      "runSandboxVerification requires a runTrial function (an isolated Work Runner trial)",
    );
  }

  let recipeFile = null;
  let status = null;
  for (const candidate of BANK_STATUSES) {
    const file = join(root, candidate, id, "recipe.md");
    if (existsSync(file)) {
      recipeFile = file;
      status = candidate;
      break;
    }
  }
  if (!recipeFile) {
    throw new Error(`recipe not found: ${id}`);
  }
  const recipe = parseRecipe(readFileSync(recipeFile, "utf8"));

  const outcome = await runTrial({ id, status, recipe });
  const verified = outcome?.passed === true;

  const recipes = readVerificationLedger(root);
  recipes[id] = { verified, verifiedAt: now() };
  writeVerificationLedger(root, recipes);

  return { id, verified };
};

// A3: the generic smoke trial — the default runTrial wiring.
//
// Boots the recipe on a REAL runner (createRunner, e.g.
// createDefaultRunnerFactory from runner-factory.js) inside an ISOLATED
// scoped workspace (a fresh temp dir unless the caller scopes one). The
// isolation is wired to the RUNTIME boundary (H-1): the trial workspace is
// both the scoped-runner workspace check AND the runner's per-call execution
// cwd (for codex that also pins the cwd-derived sandboxPolicy.writableRoots).
// The trial hands the runner a fixed contract-check task and judges only the
// response FORM: status
// "completed" with a non-empty summary string passes; anything else —
// failure, malformed output, timeout, or ANY thrown error (including
// runner_unavailable from the factory) — yields { passed: false }, so
// runSandboxVerification records verified:false (fail-closed).
//
// The run goes through createScopedWorkRunnerMicroHarness, so the same
// policy / workspace enforcement as every other delegate path is live here
// (invariant 3): a denied policy fails the smoke before the worker runs.
export const SMOKE_TRIAL_INSTRUCTION =
  'Contract check: reply with exactly "OK" and nothing else.';

export const createSmokeTrial = ({
  createRunner,
  workspace = null,
  workRunnerPolicy = null,
  audience = undefined,
  timeoutMs = 120_000,
} = {}) => {
  if (typeof createRunner !== "function") {
    throw new Error(
      "createSmokeTrial requires createRunner({ id, recipe }) — e.g. createDefaultRunnerFactory",
    );
  }
  return async ({ id, recipe }) => {
    let timer = null;
    try {
      const trialWorkspace =
        workspace ?? mkdtempSync(join(tmpdir(), "iroharness-smoke-"));
      // H-1: the trial workspace is the runner's EXECUTION boundary too —
      // passed as the per-call cwd so the child process (and codex's
      // cwd-derived sandboxPolicy.writableRoots) actually runs inside it,
      // not just past the scoped-runner workspace check.
      const worker = createRunner({ id, recipe, cwd: trialWorkspace });
      const scoped = createScopedWorkRunnerMicroHarness({
        id,
        worker,
        // null = the scoped runner's own default policy (owner / allowed);
        // an explicit policy (e.g. the view export) is enforced as-is.
        ...(workRunnerPolicy ? { policy: workRunnerPolicy } : {}),
        allowedWorkspaces: [trialWorkspace],
        defaultWorkspace: trialWorkspace,
        capabilities: Array.isArray(recipe?.toolset) ? recipe.toolset : [],
      });
      const task = Object.freeze({
        id: `smoke-${id}`,
        title: `sandbox smoke: ${id}`,
        purpose: SMOKE_TRIAL_INSTRUCTION,
      });
      const timeout = new Promise((resolvePromise) => {
        timer = setTimeout(
          () =>
            resolvePromise({
              status: "failed",
              summary: `smoke trial timed out after ${timeoutMs}ms`,
            }),
          timeoutMs,
        );
      });
      const result = await Promise.race([
        scoped.run(task, { audience }),
        timeout,
      ]);
      const passed =
        result?.status === "completed" &&
        typeof result?.summary === "string" &&
        result.summary.trim().length > 0;
      return { passed, summary: result?.summary ?? null };
    } catch (error) {
      return { passed: false, summary: error?.message ?? String(error) };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
};
