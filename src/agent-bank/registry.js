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

import { parseRecipe } from "./recipe.js";

export const BANK_STATUSES = Object.freeze(["staging", "active", "archived"]);

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
    for (const status of BANK_STATUSES) {
      const file = recipeFile(status, id);
      if (existsSync(file)) {
        return { status, recipe: parseRecipe(readFileSync(file, "utf8")) };
      }
    }
    throw new Error(`recipe not found: ${id}`);
  };

  const move = (id, toStatus) => {
    if (!BANK_STATUSES.includes(toStatus)) {
      throw new Error(`unknown status: ${toStatus}`);
    }
    const current = read(id); // throws if missing
    mkdirSync(statusDir(toStatus), { recursive: true });
    renameSync(
      join(statusDir(current.status), id),
      join(statusDir(toStatus), id),
    );
    return toStatus;
  };

  return Object.freeze({ list, read, move });
};
