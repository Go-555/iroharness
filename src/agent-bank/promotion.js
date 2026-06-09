// Promotion eligibility (Phase 5.2, W-3).
// Authority lives in the inputs passed here (a security-review verdict recorded
// by bantou, the recipe's origin, an explicit owner approval) — NOT in the
// recipe's own frontmatter. Returns { ok, reasons } so the composite promotion
// gate (Phase 2.2) can combine it with threshold + sandbox + folder checks.

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

export const evaluatePromotion = ({
  ledgerEntry,
  thresholds = DEFAULT_PROMOTION_THRESHOLDS,
  sandboxVerified = false,
  securityReview,
  origin,
  ownerApproval = false,
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
  if (sandboxVerified !== true) {
    reasons.push("not sandbox-verified");
  }

  reasons.push(
    ...canPromoteToActive({ securityReview, origin, ownerApproval }).reasons,
  );

  const verdict = { promote: reasons.length === 0, reasons };
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
