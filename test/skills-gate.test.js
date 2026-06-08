import assert from "node:assert/strict";
import test from "node:test";

import { isSkillEligible, parseSkillGating } from "../src/skills/gate.js";

test("parseSkillGating reads the three flat keys", () => {
  const g = parseSkillGating({
    view: "trusted",
    capability: "delegate_work",
    requires: "stream.enabled",
  });
  assert.equal(g.view, "trusted");
  assert.equal(g.capability, "delegate_work");
  assert.equal(g.requires, "stream.enabled");
});

test("parseSkillGating defaults: view=public, capability/requires=null", () => {
  const g = parseSkillGating({});
  assert.equal(g.view, "public");
  assert.equal(g.capability, null);
  assert.equal(g.requires, null);
});

test("view gating: session must rank >= skill view", () => {
  const trustedSkill = parseSkillGating({ view: "trusted" });
  const publicSkill = parseSkillGating({ view: "public" });
  assert.equal(isSkillEligible({ gating: publicSkill, view: "public" }), true);
  assert.equal(
    isSkillEligible({ gating: trustedSkill, view: "public" }),
    false,
  );
  assert.equal(
    isSkillEligible({ gating: trustedSkill, view: "trusted" }),
    true,
  );
  assert.equal(isSkillEligible({ gating: trustedSkill, view: "owner" }), true);
});

test("isSkillEligible rejects an unknown view layer", () => {
  assert.equal(
    isSkillEligible({ gating: parseSkillGating({}), view: "nonsense" }),
    false,
  );
});
