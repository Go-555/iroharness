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

import { isPassingPromotionVerdict } from "./promotion.js";
import { parseRecipe } from "./recipe.js";

export const BANK_STATUSES = Object.freeze(["staging", "active", "archived"]);

// Fix 3: single id validator applied at every entry point that turns an id
// into a filesystem path. Rejects traversal ("..", "../x"), separators, and
// anything not starting with an alphanumeric (so "." and ".hidden" fail too).
const RECIPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const assertValidRecipeId = (id) => {
  if (
    typeof id !== "string" ||
    !RECIPE_ID_PATTERN.test(id) ||
    id.includes("/") ||
    id.includes("\\") ||
    id === "." ||
    id === ".."
  ) {
    throw new Error(`invalid recipe id: ${JSON.stringify(id)}`);
  }
  return id;
};

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
        return { status, recipe: parseRecipe(readFileSync(file, "utf8")) };
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
    if (toStatus === "active" && !isPassingPromotionVerdict(promotion)) {
      throw new Error(
        "moving a recipe to active requires a passing verdict from the composite promotion gate (evaluatePromotion)",
      );
    }
    const current = read(id); // throws if missing
    mkdirSync(statusDir(toStatus), { recursive: true });
    renameSync(
      join(statusDir(current.status), id),
      join(statusDir(toStatus), id),
    );
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
