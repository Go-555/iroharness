// Decay executor (mekiki W-D). shouldDecay (promotion.js) is the predicate;
// this is the broom: walk every ACTIVE recipe, join it against the
// beads-derived ledger, and retire the decayed ones to archived/.
//
// Retirement needs no promotion verdict — only the move INTO active is gated
// (registry.move enforces that); archived is the recoverable shelf.
//
// KNOWN BEHAVIOR (pinned by test, deliberately unchanged): an active recipe
// with NO ledger entry — promoted but never used since — has no lastUsed, so
// shouldDecay returns false and the sweep keeps it forever ("immortal").
// Changing that is a design decision (e.g. decay from promotion date), not a
// sweep detail; until then never-used actives survive every sweep.

import { computeLedger } from "./ledger.js";
import { shouldDecay } from "./promotion.js";
import { createBankRegistry } from "./registry.js";

export const DEFAULT_MAX_IDLE_DAYS = 30;

export const sweepDecayedRecipes = ({
  root,
  projectOs,
  now = new Date().toISOString(),
  maxIdleDays = DEFAULT_MAX_IDLE_DAYS,
  dryRun = false,
} = {}) => {
  const registry = createBankRegistry({ root });
  const ledger = computeLedger(projectOs ? projectOs.snapshot() : { runs: [] });

  const decayed = [];
  const kept = [];
  for (const id of registry.list("active")) {
    const lastUsed = ledger[id]?.lastUsed ?? null;
    if (shouldDecay({ lastUsed, now, maxIdleDays })) {
      if (!dryRun) {
        registry.move(id, "archived");
      }
      decayed.push(id);
    } else {
      kept.push(id);
    }
  }

  return { decayed, kept, dryRun, maxIdleDays };
};
