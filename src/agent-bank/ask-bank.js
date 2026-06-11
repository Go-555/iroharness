// ask_bank (A2): the menu of ACTIVE regulars, for an LLM to choose from.
//
// Deliberately NOT a machine ranking (親方決定 A2): askBank only assembles
// the facts — id, role, capabilities (toolset) and the DERIVED track record
// (computeLedger over ProjectOs runs; a specialist cannot inflate it) — as a
// compact frozen structure plus a text menu. The consumers are the brain
// (context injection) and the Hanaita's chooseRecipe callback; whatever they
// pick still has to pass the hire gate (active-only, assertValidRecipeId):
// the selection is a proposal, the gate is the authority.
//
// staging / archived recipes never appear on the menu (folder authority).

import { computeLedger } from "./ledger.js";
import { createBankRegistry } from "./registry.js";

const formatScore = (score) =>
  Number.isFinite(score) ? `${Math.round(score * 100) / 100}` : "n/a";

const renderMenu = (recipes) => {
  const lines = ["# Agent Bank — active regulars"];
  if (recipes.length === 0) {
    lines.push("(no active recipes)");
  }
  for (const entry of recipes) {
    lines.push(`- ${entry.id} — ${entry.role}`);
    if (entry.capabilities.length > 0) {
      lines.push(`  capabilities: ${entry.capabilities.join(", ")}`);
    }
    lines.push(
      entry.ledger
        ? `  track record: calls ${entry.ledger.calls}, success ${entry.ledger.success}, ` +
            `avg score ${formatScore(entry.ledger.avgScore)}, last used ${entry.ledger.lastUsed ?? "n/a"}`
        : "  track record: untried (no recorded runs)",
    );
  }
  return `${lines.join("\n")}\n`;
};

export const askBank = ({ root, projectOs = null } = {}) => {
  if (!root) {
    throw new Error("askBank requires the bank root");
  }
  const registry = createBankRegistry({ root });
  const ledger = projectOs ? computeLedger(projectOs.snapshot()) : {};

  const recipes = registry.list("active").map((id) => {
    const { recipe } = registry.read(id);
    const stats = Object.hasOwn(ledger, id) ? ledger[id] : null;
    return Object.freeze({
      id,
      role:
        typeof recipe.role === "string" && recipe.role.trim()
          ? recipe.role
          : id,
      capabilities: Object.freeze(
        Array.isArray(recipe.toolset) ? [...recipe.toolset] : [],
      ),
      ledger: stats
        ? Object.freeze({
            calls: stats.calls,
            success: stats.success,
            avgScore: stats.avgScore,
            lastUsed: stats.lastUsed,
          })
        : null,
    });
  });

  return Object.freeze({
    recipes: Object.freeze(recipes),
    text: renderMenu(recipes),
  });
};
