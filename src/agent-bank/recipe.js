// Recipe parser for the Agent Bank.
// Dependency-free frontmatter parsing (IroHarness ships with zero deps).
// recipe.md = YAML-ish frontmatter (scalars + inline arrays) + markdown body.

// B-2: security-sensitive fields a recipe might self-declare. These are NEVER
// trusted from the recipe's own frontmatter; authority lives in the folder
// position + ledger. The parser quarantines them into `declared` (advisory).
const SECURITY_FIELDS = ["status", "security_review", "visibility"];

const parseScalarOrList = (raw) => {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return raw;
};

export const parseRecipe = (markdown) => {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown);
  if (!match) {
    throw new Error("recipe is missing frontmatter");
  }
  const [, frontmatter, body] = match;

  const meta = {};
  for (const line of frontmatter.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const sep = line.indexOf(":");
    if (sep === -1) {
      continue;
    }
    const key = line.slice(0, sep).trim();
    const raw = line.slice(sep + 1).trim();
    meta[key] = parseScalarOrList(raw);
  }

  if (!meta.id || typeof meta.id !== "string") {
    throw new Error("recipe is missing id");
  }

  const declared = {};
  for (const field of SECURITY_FIELDS) {
    if (field in meta) {
      declared[field] = meta[field];
      delete meta[field];
    }
  }

  return { ...meta, declared, body };
};
