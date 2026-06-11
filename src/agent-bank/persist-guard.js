// Persist guard + persistence hookup (Phase 3.2, B-4).
// Promoting/persisting a recipe to a runtime (OpenClaw `agents add`, a Claude
// Code agent file, ...) must write inside a scoped workspace. Writing to a
// host-global location (e.g. ~/.claude/agents) would let a recipe escape
// iroharness's boundary and be auto-loaded host-wide, so it is forbidden unless
// the owner explicitly approves. Host-global agent dirs additionally sit on a
// default DENY list that wins even over a misconfigured allowedRoots (an
// allowlist covering the home dir does not waive owner approval).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

import { assertValidRecipeId, BANK_STATUSES } from "./registry.js";

// Host-global agent dirs auto-loaded by runtimes on this host. Persisting here
// is denied by default regardless of allowedRoots.
export const DEFAULT_HOST_GLOBAL_AGENT_DIRS = Object.freeze([
  join(homedir(), ".claude", "agents"),
  join(homedir(), ".codex", "agents"),
  join(homedir(), ".openclaw", "agents"),
]);

// bantou M-1 (symlink hardening): a lexical resolve() does not follow
// symlinks, so a symlink inside an allowed root pointing at a host-global
// agent dir would pass the allowlist and dodge the deny list. Compare REAL
// paths instead. A persist target usually does not exist yet, so the nearest
// EXISTING ancestor is realpath'd and the non-existing remainder re-joined.
const realpathNearest = (path) => {
  let current = resolve(path);
  const remainder = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      break; // filesystem root
    }
    remainder.unshift(basename(current));
    current = parent;
  }
  try {
    current = realpathSync(current);
  } catch {
    // raced away or unreadable: fall back to the lexical path (fail towards
    // the stricter comparison, never towards granting)
  }
  return remainder.length > 0 ? join(current, ...remainder) : current;
};

const isInside = (child, parent) => {
  const c = realpathNearest(child);
  const p = realpathNearest(parent);
  return c === p || c.startsWith(p + sep);
};

export const assertPersistTargetAllowed = ({
  targetPath,
  allowedRoots = [],
  ownerApproval = false,
  hostGlobalRoots = DEFAULT_HOST_GLOBAL_AGENT_DIRS,
}) => {
  // Deny list first: a host-global agent dir requires owner approval even if
  // an (over-broad) allowedRoots happens to cover it.
  const hostGlobal = hostGlobalRoots.some((root) => isInside(targetPath, root));
  if (!hostGlobal && allowedRoots.some((root) => isInside(targetPath, root))) {
    return true;
  }
  if (ownerApproval === true) {
    return true;
  }
  throw new Error(
    `persist target is outside the scoped workspace and requires explicit owner approval: ${targetPath}`,
  );
};

// The persistence hookup: write a Bank recipe out as a persistent runtime
// definition. Only ACTIVE recipes may be persisted — persisting is the
// "promotion = write a persistent definition" step (§8), and letting a staging
// recipe escape to a runtime would bypass the composite promotion gate.
export const persistRecipe = ({
  root,
  id,
  targetPath,
  allowedRoots = [],
  ownerApproval = false,
  hostGlobalRoots = DEFAULT_HOST_GLOBAL_AGENT_DIRS,
}) => {
  assertValidRecipeId(id);

  const activeFile = join(root, "active", id, "recipe.md");
  if (!existsSync(activeFile)) {
    const elsewhere = BANK_STATUSES.some((status) =>
      existsSync(join(root, status, id, "recipe.md")),
    );
    throw new Error(
      elsewhere
        ? `recipe ${id} is not active; only active recipes may be persisted`
        : `recipe not found: ${id}`,
    );
  }

  assertPersistTargetAllowed({
    targetPath,
    allowedRoots,
    ownerApproval,
    hostGlobalRoots,
  });

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, readFileSync(activeFile, "utf8"));
  return { id, targetPath };
};
