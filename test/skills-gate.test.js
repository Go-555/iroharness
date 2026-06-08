import assert from "node:assert/strict";
import test from "node:test";

import { parseSkillGating } from "../src/skills/gate.js";

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
