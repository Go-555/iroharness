// Seed: register an existing built-in micro-harness as a Bank recipe.
// Read-only over the harness (never mutates it): the existing direct delegation
// path is untouched; the recipe is an additional, parallel Bank entry.
//
// B-1: seeding also records the builtin id in `seed-manifest.json` at the bank
// root — outside any recipe folder, so a recipe's frontmatter can never taint
// it. That manifest is the single authority for origin: an id listed there is
// "builtin"; anything else is "minted" (fail-safe).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertValidRecipeId, BANK_STATUSES } from "./registry.js";

const SEED_MANIFEST_FILE = "seed-manifest.json";

const manifestPath = (root) => join(root, SEED_MANIFEST_FILE);

const isValidRecipeId = (id) => {
  try {
    assertValidRecipeId(id);
    return true;
  } catch {
    return false;
  }
};

// Fail-safe reader: a missing or unparsable manifest yields no builtins, and
// tainted entries (anything failing assertValidRecipeId) are dropped so they
// can never grant builtin status.
const readSeedManifest = (root) => {
  const file = manifestPath(root);
  if (!existsSync(file)) {
    return { builtins: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { builtins: [] };
  }
  const builtins = Array.isArray(parsed?.builtins) ? parsed.builtins : [];
  return { builtins: builtins.filter(isValidRecipeId) };
};

const writeSeedManifest = (root, manifest) => {
  writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
};

// The single origin decision (W-3 input). Listed in the manifest -> builtin;
// not listed (or the manifest is missing/tainted) -> minted, fail-safe.
export const originOf = ({ root, id }) => {
  assertValidRecipeId(id);
  return readSeedManifest(root).builtins.includes(id) ? "builtin" : "minted";
};

export const seedHarnessRecipe = ({
  root,
  id,
  role,
  harness,
  status = "active",
}) => {
  if (!id) {
    throw new Error("seedHarnessRecipe requires id");
  }
  assertValidRecipeId(id);
  // Bantou re-audit Fix B: `status` becomes a path segment below, so it gets
  // the same whitelist treatment as `id` — anything outside the known bank
  // statuses (including traversal like "../escaped") is rejected.
  if (!BANK_STATUSES.includes(status)) {
    throw new Error(`invalid bank status: ${JSON.stringify(status)}`);
  }
  const toolset = Array.isArray(harness?.capabilities)
    ? harness.capabilities
    : [];

  const md = [
    "---",
    `id: ${id}`,
    `role: ${role || id}`,
    `toolset: [${toolset.join(", ")}]`,
    "source: builtin-harness",
    "---",
    "",
    "Seeded from a built-in micro-harness. Delegation continues through the",
    "existing adapter; this recipe is an additional Bank entry, not a replacement.",
    "",
  ].join("\n");

  const dir = join(root, status, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "recipe.md"), md);

  // B-1: record the builtin id in the root manifest (the origin authority).
  const manifest = readSeedManifest(root);
  if (!manifest.builtins.includes(id)) {
    manifest.builtins.push(id);
    writeSeedManifest(root, manifest);
  }

  return { id, status };
};
