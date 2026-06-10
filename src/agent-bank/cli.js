// Agent Bank CLI logic (Phase 2.3). Pure-ish: takes the bank root, parsed argv,
// and a Project OS handle; returns { output, exitCode }. A future
// `iroharness bank <...>` subcommand in bin/iroharness.mjs is planned to wire
// to this (not wired yet). Promotion always goes through the single composite
// gate (evaluatePromotion) — the CLI never bypasses it.

import { computeLedger } from "./ledger.js";
import { evaluatePromotion } from "./promotion.js";
import { createBankRegistry } from "./registry.js";
import { originOf } from "./seed.js";

export const runBankCommand = ({
  root,
  argv = [],
  projectOs,
  promotionContext = {},
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

  return { output: `unknown bank command: ${sub ?? "(none)"}`, exitCode: 1 };
};
