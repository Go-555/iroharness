// Persist guard (Phase 3.2, B-4).
// Promoting/persisting a recipe to a runtime (OpenClaw `agents add`, a Claude
// Code agent file, ...) must write inside a scoped workspace. Writing to a
// host-global location (e.g. ~/.claude/agents) would let a recipe escape
// iroharness's boundary and be auto-loaded host-wide, so it is forbidden unless
// the owner explicitly approves.

import { resolve, sep } from "node:path";

const isInside = (child, parent) => {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + sep);
};

export const assertPersistTargetAllowed = ({
  targetPath,
  allowedRoots = [],
  ownerApproval = false,
}) => {
  const inScope = allowedRoots.some((root) => isInside(targetPath, root));
  if (inScope) {
    return true;
  }
  if (ownerApproval === true) {
    return true;
  }
  throw new Error(
    `persist target is outside the scoped workspace and requires explicit owner approval: ${targetPath}`,
  );
};
