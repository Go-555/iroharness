// Bank registry: manages recipe.md files across staging / active / archived
// folders. The folder a recipe lives in IS its authoritative status (B-2:
// frontmatter is not trusted). Promotion / retirement = a folder move.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

import { assertValidRecipeId, BANK_STATUSES } from "./ids.js";
import {
  consumePromotionVerdict,
  isPassingPromotionVerdict,
} from "./promotion.js";
import { parseRecipe } from "./recipe.js";

// BANK_STATUSES and the Fix 3 id validator live in ids.js (dependency-free, so
// leaf modules can use them without import cycles); re-exported here because
// this module is their historical home.
export { assertValidRecipeId, BANK_STATUSES } from "./ids.js";

export const createBankRegistry = ({ root }) => {
  const statusDir = (status) => join(root, status);
  const recipeFile = (status, id) => join(statusDir(status), id, "recipe.md");

  const list = (status) => {
    const dir = statusDir(status);
    if (!existsSync(dir)) {
      return [];
    }
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  };

  const read = (id) => {
    assertValidRecipeId(id);
    for (const status of BANK_STATUSES) {
      const file = recipeFile(status, id);
      if (existsSync(file)) {
        const recipe = parseRecipe(readFileSync(file, "utf8"));
        // mekiki recommendation-7: the FOLDER NAME is the id authority, same
        // as the folder is the status authority (B-2). A frontmatter id that
        // disagrees is advisory only — quarantined into `declared` so a
        // recipe cannot display-spoof another specialist's id.
        if (recipe.id !== id) {
          recipe.declared.id = recipe.id;
        }
        recipe.id = id;
        return { status, recipe };
      }
    }
    throw new Error(`recipe not found: ${id}`);
  };

  const move = (id, toStatus, { promotion } = {}) => {
    assertValidRecipeId(id);
    if (!BANK_STATUSES.includes(toStatus)) {
      throw new Error(`unknown status: ${toStatus}`);
    }
    // Fix 1 (W-5): a raw move into active is not a promotion path. It requires
    // a passing verdict issued by the composite gate (evaluatePromotion).
    if (toStatus === "active") {
      if (!isPassingPromotionVerdict(promotion)) {
        throw new Error(
          "moving a recipe to active requires a passing verdict from the composite promotion gate (evaluatePromotion); verdicts are single-use",
        );
      }
      // Bantou re-audit Fix A: the verdict only authorizes the recipe it was
      // evaluated for — a verdict earned by one recipe cannot promote another.
      if (promotion.recipeId !== id) {
        throw new Error(
          `promotion verdict is bound to recipe ${JSON.stringify(promotion.recipeId)}, not ${JSON.stringify(id)}`,
        );
      }
    }
    const current = read(id); // throws if missing
    mkdirSync(statusDir(toStatus), { recursive: true });
    renameSync(
      join(statusDir(current.status), id),
      join(statusDir(toStatus), id),
    );
    if (toStatus === "active") {
      // Single-use: the verdict is spent by this successful promotion.
      consumePromotionVerdict(promotion);
    }
    return toStatus;
  };

  const renderIndex = ({ includeArchived = false } = {}) => {
    const statuses = includeArchived
      ? BANK_STATUSES
      : BANK_STATUSES.filter((status) => status !== "archived");
    const lines = [
      "# Agent Bank Index",
      "",
      "| id | role | status |",
      "|----|------|--------|",
    ];
    // Fix 4: escape "|" in cell values so they cannot break the table.
    const cell = (value) => String(value ?? "").replaceAll("|", "\\|");
    for (const status of statuses) {
      for (const id of list(status)) {
        const { recipe } = read(id);
        lines.push(`| ${cell(recipe.id)} | ${cell(recipe.role)} | ${status} |`);
      }
    }
    return `${lines.join("\n")}\n`;
  };

  return Object.freeze({ list, read, move, renderIndex });
};
