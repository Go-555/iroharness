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
