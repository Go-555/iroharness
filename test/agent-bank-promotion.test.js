import assert from "node:assert/strict";
import test from "node:test";

import {
  canPromoteToActive,
  evaluatePromotion,
  shouldDecay,
} from "../src/agent-bank/promotion.js";

const passingInputs = {
  recipeId: "demo",
  ledgerEntry: { calls: 3, success: 3, avgScore: 4.6 },
  sandboxVerified: true,
  securityReview: { passed: true, by: "bantou" },
  origin: "builtin",
};

test("promotion is blocked without a passed security review", () => {
  const result = canPromoteToActive({
    securityReview: null,
    origin: "builtin",
  });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /security[_ ]review/i);
});

test("a builtin (seed) recipe with a passed review can be promoted without owner approval", () => {
  const result = canPromoteToActive({
    securityReview: { passed: true, by: "bantou" },
    origin: "builtin",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
});

// W-3: a minted (dynamically generated) recipe's FIRST promotion to active
// requires explicit owner approval, even with a passed review.
test("a minted recipe cannot be first-promoted without owner approval", () => {
  const result = canPromoteToActive({
    securityReview: { passed: true, by: "bantou" },
    origin: "minted",
    ownerApproval: false,
  });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /owner/i);
});

test("a minted recipe can be promoted once the owner approves", () => {
  const result = canPromoteToActive({
    securityReview: { passed: true, by: "bantou" },
    origin: "minted",
    ownerApproval: true,
  });
  assert.equal(result.ok, true);
});

test("evaluatePromotion promotes only when threshold AND sandbox AND review all hold", () => {
  assert.equal(evaluatePromotion(passingInputs).promote, true);
});

test("evaluatePromotion blocks when call/success threshold is not met", () => {
  const result = evaluatePromotion({
    ...passingInputs,
    ledgerEntry: { calls: 1, success: 1, avgScore: 4.6 },
  });
  assert.equal(result.promote, false);
});

test("evaluatePromotion blocks when not sandbox-verified", () => {
  const result = evaluatePromotion({
    ...passingInputs,
    sandboxVerified: false,
  });
  assert.equal(result.promote, false);
  assert.match(result.reasons.join(" "), /sandbox/i);
});

// W-5: there is no promotion path that bypasses the composite gate — failing the
// security review (a 5.2 concern) blocks promotion through this single entry too.
test("evaluatePromotion blocks when the security review has not passed", () => {
  const result = evaluatePromotion({ ...passingInputs, securityReview: null });
  assert.equal(result.promote, false);
  assert.match(result.reasons.join(" "), /security[_ ]review/i);
});

test("evaluatePromotion blocks a minted recipe without owner approval", () => {
  const result = evaluatePromotion({
    ...passingInputs,
    origin: "minted",
    ownerApproval: false,
  });
  assert.equal(result.promote, false);
  assert.match(result.reasons.join(" "), /owner/i);
});

// Bantou re-audit Fix A: the verdict carries the recipe it was evaluated for,
// and the binding cannot be rewritten after issuance.
test("evaluatePromotion binds the verdict to the recipe id and freezes it", () => {
  const verdict = evaluatePromotion(passingInputs);
  assert.equal(verdict.recipeId, "demo");
  assert.equal(Object.isFrozen(verdict), true);
});

test("evaluatePromotion never issues a passing verdict without a recipe id", () => {
  const { recipeId, ...withoutId } = passingInputs;
  const verdict = evaluatePromotion(withoutId);
  assert.equal(verdict.promote, false);
  assert.match(verdict.reasons.join(" "), /recipe id/i);
});

// ajimi (boundary fixation): the threshold comparisons are strict `<`, so a
// value EXACTLY at the threshold passes. These tests document that semantics
// as the spec — they must not be "fixed" to `<=` without a design decision.
test("exact-threshold values (calls, success rate, avgScore) all pass the gate", () => {
  const verdict = evaluatePromotion({
    ...passingInputs,
    // calls == minCalls (3), successRate == minSuccessRate (4/5 = 0.8),
    // avgScore == minScore (4.0): all sit exactly on the line.
    ledgerEntry: { calls: 5, success: 4, avgScore: 4.0 },
  });
  assert.equal(verdict.promote, true);
  assert.deepEqual(verdict.reasons, []);
});

test("calls exactly at minCalls passes; one below blocks", () => {
  const at = evaluatePromotion({
    ...passingInputs,
    ledgerEntry: { calls: 3, success: 3, avgScore: 4.0 },
  });
  assert.equal(at.promote, true);

  const below = evaluatePromotion({
    ...passingInputs,
    ledgerEntry: { calls: 2, success: 2, avgScore: 4.0 },
  });
  assert.equal(below.promote, false);
  assert.match(below.reasons.join(" "), /calls/i);
});

test("success rate just below the threshold blocks", () => {
  const result = evaluatePromotion({
    ...passingInputs,
    ledgerEntry: { calls: 4, success: 3, avgScore: 4.6 }, // 0.75 < 0.8
  });
  assert.equal(result.promote, false);
  assert.match(result.reasons.join(" "), /success rate/i);
});

test("avgScore just below minScore blocks", () => {
  const result = evaluatePromotion({
    ...passingInputs,
    ledgerEntry: { calls: 3, success: 3, avgScore: 3.999 },
  });
  assert.equal(result.promote, false);
  assert.match(result.reasons.join(" "), /avgScore/i);
});

test("shouldDecay flags an active recipe idle beyond the window", () => {
  assert.equal(
    shouldDecay({
      lastUsed: "2026-05-01T00:00:00Z",
      now: "2026-06-06T00:00:00Z",
      maxIdleDays: 30,
    }),
    true,
  );
});

test("shouldDecay keeps a recently used recipe", () => {
  assert.equal(
    shouldDecay({
      lastUsed: "2026-06-01T00:00:00Z",
      now: "2026-06-06T00:00:00Z",
      maxIdleDays: 30,
    }),
    false,
  );
});

// ajimi (boundary fixation): the decay comparison is strict `>` — idle for
// EXACTLY maxIdleDays does not decay; one millisecond past the window does.
test("shouldDecay keeps a recipe idle for exactly maxIdleDays", () => {
  assert.equal(
    shouldDecay({
      lastUsed: "2026-05-07T00:00:00Z",
      now: "2026-06-06T00:00:00Z", // exactly 30 days later
      maxIdleDays: 30,
    }),
    false,
  );
});

test("shouldDecay flags a recipe one millisecond past the window", () => {
  assert.equal(
    shouldDecay({
      lastUsed: "2026-05-07T00:00:00Z",
      now: "2026-06-06T00:00:00.001Z",
      maxIdleDays: 30,
    }),
    true,
  );
});

// Known behavior (fixed by test, not changed): a recipe with NO lastUsed —
// an active recipe that was never used — never decays. shouldDecay returns
// false for a missing lastUsed, making never-used actives "immortal" until a
// future design decision says otherwise.
test("shouldDecay never flags a recipe without a lastUsed (never-used actives are immortal)", () => {
  for (const lastUsed of [null, undefined, ""]) {
    assert.equal(
      shouldDecay({ lastUsed, now: "2099-01-01T00:00:00Z", maxIdleDays: 30 }),
      false,
    );
  }
});
