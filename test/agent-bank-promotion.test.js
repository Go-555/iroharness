import assert from "node:assert/strict";
import test from "node:test";

import { canPromoteToActive } from "../src/agent-bank/promotion.js";

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
