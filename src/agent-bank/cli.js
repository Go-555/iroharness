// Agent Bank CLI logic (Phase 2.3 + W-D). Pure-ish: takes the bank root,
// parsed argv, and a Project OS handle; returns { output, exitCode }. Wired
// into bin/iroharness.mjs as `iroharness bank <list|promote|sweep>`.
// Promotion always goes through the single composite gate (evaluatePromotion)
// — the CLI never bypasses it.

import { computeLedger } from "./ledger.js";
import { evaluatePromotion } from "./promotion.js";
import { createBankRegistry } from "./registry.js";
import { originOf } from "./seed.js";
import { DEFAULT_MAX_IDLE_DAYS, sweepDecayedRecipes } from "./sweep.js";

export const runBankCommand = ({
  root,
  argv = [],
  projectOs,
  promotionContext = {},
  // Injectable clock for the sweep (tests); defaults to the real now.
  now = new Date().toISOString(),
}) => {
  const registry = createBankRegistry({ root });
  const [sub, ...rest] = argv;

  if (sub === "list") {
    return {
      output: registry.renderIndex({ includeArchived: rest.includes("--all") }),
      exitCode: 0,
    };
  }

  if (sub === "promote") {
    const id = rest[0];
    if (!id) {
      return {
        output: "usage: bank promote <id> [--owner-approve]",
        exitCode: 1,
      };
    }
    registry.read(id); // throws if missing or invalid id
    const ledger = computeLedger(
      projectOs ? projectOs.snapshot() : { runs: [] },
    );

    const verdict = evaluatePromotion({
      // Fix A: the verdict is bound to this recipe and is single-use.
      recipeId: id,
      ledgerEntry: ledger[id],
      // Phase 3.3: passing the bank root makes the verification ledger
      // (runSandboxVerification's record) the authority — a recorded trial
      // outcome overrides the self-reported context below in both directions.
      root,
      sandboxVerified: promotionContext.sandboxVerified === true,
      securityReview: promotionContext.securityReview ?? null,
      // B-1: origin comes from the seed manifest at the bank root (folder-
      // level authority), never from the recipe's own frontmatter `source`.
      origin: originOf({ root, id }),
      // Fix 2 (W-3): running the CLI is not owner approval. The owner must
      // state it explicitly.
      ownerApproval: rest.includes("--owner-approve"),
    });

    if (!verdict.promote) {
      return {
        output: `${id} not promoted:\n- ${verdict.reasons.join("\n- ")}`,
        exitCode: 1,
      };
    }

    registry.move(id, "active", { promotion: verdict });
    return { output: `promoted ${id} to active`, exitCode: 0 };
  }

  // mekiki W-D: the decay executor. Active recipes idle beyond the window are
  // retired to archived/ (no verdict needed — only moves INTO active are
  // gated). Never-used actives have no lastUsed and are kept (see sweep.js).
  if (sub === "sweep") {
    const dryRun = rest.includes("--dry-run");
    let maxIdleDays = DEFAULT_MAX_IDLE_DAYS;
    const flagIndex = rest.indexOf("--max-idle-days");
    if (flagIndex !== -1) {
      maxIdleDays = Number(rest[flagIndex + 1]);
      if (!Number.isFinite(maxIdleDays) || maxIdleDays <= 0) {
        return {
          output: "usage: bank sweep [--max-idle-days <days>] [--dry-run]",
          exitCode: 1,
        };
      }
    }

    const result = sweepDecayedRecipes({
      root,
      projectOs,
      now,
      maxIdleDays,
      dryRun,
    });

    const lines = result.decayed.map((id) =>
      dryRun ? `would archive ${id}` : `archived ${id}`,
    );
    if (result.decayed.length === 0) {
      lines.push("nothing to archive");
    }
    lines.push(
      `swept active: ${result.decayed.length} ${dryRun ? "candidate(s)" : "archived"}, kept: ${result.kept.length} (max idle ${result.maxIdleDays} days)`,
    );
    return { output: lines.join("\n"), exitCode: 0 };
  }

  return { output: `unknown bank command: ${sub ?? "(none)"}`, exitCode: 1 };
};
