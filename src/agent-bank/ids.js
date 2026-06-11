// Shared, dependency-free Bank identifiers. Split out of registry.js so leaf
// modules (sandbox.js, promotion.js) can validate ids without importing the
// registry — registry.js itself imports promotion.js, and an import back into
// it would create a cycle. registry.js re-exports these for compatibility.

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
