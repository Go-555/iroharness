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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
