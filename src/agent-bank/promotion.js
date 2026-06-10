// Promotion eligibility (Phase 5.2, W-3).
// Authority lives in the inputs passed here (a security-review verdict recorded
// by bantou, the recipe's origin, an explicit owner approval) — NOT in the
// recipe's own frontmatter. Returns { ok, reasons } so the composite promotion
// gate (Phase 2.2) can combine it with threshold + sandbox + folder checks.

import { lookupSandboxVerification } from "./sandbox.js";

export const canPromoteToActive = ({
  securityReview,
  origin,
  ownerApproval = false,
} = {}) => {
  const reasons = [];

  if (!securityReview || securityReview.passed !== true) {
    reasons.push("security_review has not passed");
  }

  // A dynamically minted recipe's first promotion needs a human (owner) in the
  // loop. Seed/builtin recipes are curated by hand and are exempt.
  if (origin === "minted" && ownerApproval !== true) {
    reasons.push("minted recipe requires owner approval for first promotion");
  }

  return { ok: reasons.length === 0, reasons };
};

// The single composite promotion gate (Phase 2.2, W-5). There is no other path
// from staging to active: threshold (ledger) AND sandbox-verified AND the 5.2
// eligibility (security review + owner-in-loop for minted) must ALL hold.
export const DEFAULT_PROMOTION_THRESHOLDS = Object.freeze({
  minCalls: 3,
  minSuccessRate: 0.8,
  minScore: 4.0,
});

// Passing verdicts are registered here so the registry can verify a verdict
// really came from this gate (a hand-built { promote: true } is rejected).
const issuedPassingVerdicts = new WeakSet();

export const isPassingPromotionVerdict = (verdict) =>
  typeof verdict === "object" &&
  verdict !== null &&
  issuedPassingVerdicts.has(verdict);

// Single-use enforcement: the registry calls this after a successful move so
// the same verdict can never authorize a second promotion (replay).
export const consumePromotionVerdict = (verdict) => {
  issuedPassingVerdicts.delete(verdict);
};

export const evaluatePromotion = ({
  recipeId,
  ledgerEntry,
  thresholds = DEFAULT_PROMOTION_THRESHOLDS,
  sandboxVerified = false,
  securityReview,
  origin,
  ownerApproval = false,
  // Phase 3.3: when the bank root is provided, sandbox verification is derived
  // from the authoritative record (verification-ledger.json, written by
  // runSandboxVerification) — a recorded outcome always beats the caller's
  // self-reported `sandboxVerified`. Without a root the legacy self-report
  // path is unchanged (compat).
  root,
} = {}) => {
  const reasons = [];
  const entry = ledgerEntry || { calls: 0, success: 0, avgScore: null };

  if (entry.calls < thresholds.minCalls) {
    reasons.push(`calls ${entry.calls} < required ${thresholds.minCalls}`);
  }
  const successRate = entry.calls > 0 ? entry.success / entry.calls : 0;
  if (successRate < thresholds.minSuccessRate) {
    reasons.push(
      `success rate ${successRate.toFixed(2)} < required ${thresholds.minSuccessRate}`,
    );
  }
  if (
    thresholds.minScore != null &&
    (entry.avgScore == null || entry.avgScore < thresholds.minScore)
  ) {
    reasons.push(
      `avgScore ${entry.avgScore} < required ${thresholds.minScore}`,
    );
  }
  let sandboxOk = sandboxVerified === true;
  if (root !== undefined) {
    if (typeof recipeId === "string" && recipeId.length > 0) {
      const record = lookupSandboxVerification({ root, id: recipeId });
      if (record !== null) {
        // The record is the authority — it overrides the self-report in BOTH
        // directions (a recorded failure defeats a lying caller).
        sandboxOk = record.verified === true;
      }
    } else {
      // No id to look up: cannot be record-verified.
      sandboxOk = false;
    }
  }
  if (!sandboxOk) {
    reasons.push("not sandbox-verified");
  }

  reasons.push(
    ...canPromoteToActive({ securityReview, origin, ownerApproval }).reasons,
  );

  // Bantou re-audit Fix A: a passing verdict must be bound to exactly one
  // recipe, so it cannot be replayed against a different (un-reviewed) one.
  // Fail-safe: no recipe id, no passing verdict.
  if (typeof recipeId !== "string" || recipeId.length === 0) {
    reasons.push("verdict must be bound to a recipe id");
  }

  // Frozen so the recipeId binding cannot be rewritten after issuance.
  const verdict = Object.freeze({
    promote: reasons.length === 0,
    recipeId,
    reasons: Object.freeze(reasons),
  });
  if (verdict.promote) {
    issuedPassingVerdicts.add(verdict);
  }
  return verdict;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Decay: an active recipe idle beyond the window is retired to archived.
export const shouldDecay = ({ lastUsed, now, maxIdleDays }) => {
  if (!lastUsed) {
    return false;
  }
  const idleMs = new Date(now).getTime() - new Date(lastUsed).getTime();
  return idleMs > maxIdleDays * DAY_MS;
};
