// Staging tool policy (B-1).
// A staging (unproven) recipe may only request tools on this allowlist. mint
// (Phase 3.1) intersects a generated recipe's requested toolset against it, so
// a prompt-injected recipe cannot acquire privileged tools (repo-write,
// network, vault, ...). Powers widen only after promotion + security_review.

export const DEFAULT_STAGING_ALLOWLIST = Object.freeze([
  "doc-read",
  "doc-write",
  "spreadsheet-read",
  "table-lookup",
  "web-search",
  "summarize",
]);

export const loadStagingAllowlist = ({ allowlist } = {}) => {
  if (allowlist === undefined) {
    return [...DEFAULT_STAGING_ALLOWLIST];
  }
  if (!Array.isArray(allowlist)) {
    throw new Error("staging allowlist must be an array");
  }
  return allowlist.map(String);
};

export const intersectToolset = (requested, allowlist) => {
  const allowed = new Set(allowlist);
  return (requested || []).filter((tool) => allowed.has(tool));
};
