// Seed: register an existing built-in micro-harness as a Bank recipe.
// Read-only over the harness (never mutates it): the existing direct delegation
// path is untouched; the recipe is an additional, parallel Bank entry.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

  return { id, status };
};
