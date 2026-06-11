// Staging guard (bantou gate, B-1 / invariant #1).
// A staging (unproven) recipe must never hold owner visibility, vault tools, or
// any tool outside the staging allowlist. Powers widen only after promotion +
// security_review. Throws on any violation.

const VAULT_TOOLS = Object.freeze([
  "vault",
  "secret-read",
  "credential-access",
]);

export const assertStagingSafe = ({
  toolset = [],
  visibility,
  allowlist = [],
}) => {
  const violations = [];

  if (visibility === "owner") {
    violations.push("owner visibility is not allowed in staging");
  }

  const allowed = new Set(allowlist);
  const disallowed = (toolset || []).filter((tool) => !allowed.has(tool));
  if (disallowed.length > 0) {
    violations.push(`tools outside allowlist: ${disallowed.join(", ")}`);
  }

  const vault = (toolset || []).filter((tool) => VAULT_TOOLS.includes(tool));
  if (vault.length > 0) {
    violations.push(`vault tools forbidden in staging: ${vault.join(", ")}`);
  }

  if (violations.length > 0) {
    throw new Error(`staging recipe rejected: ${violations.join("; ")}`);
  }

  return true;
};
