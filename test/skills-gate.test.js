import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  gateSkills,
  isSkillEligible,
  parseSkillGating,
  readSkillGating,
} from "../src/skills/gate.js";
import { createSkillContextListing } from "../src/skills/index.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "skills-gate",
);
const skillStub = (id) => ({
  id,
  name: id,
  metadata: { manifestPath: join(fixtureDir, id, "SKILL.md") },
});

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

test("capability gating: actor must hold the named capability", () => {
  const g = parseSkillGating({ capability: "delegate_work" });
  assert.equal(
    isSkillEligible({
      gating: g,
      view: "owner",
      permissions: ["delegate_work"],
    }),
    true,
  );
  assert.equal(
    isSkillEligible({
      gating: g,
      view: "owner",
      permissions: ["manage_stream"],
    }),
    false,
  );
  assert.equal(
    isSkillEligible({ gating: g, view: "owner", permissions: [] }),
    false,
  );
});

test("requires gating: requirement must be satisfied", () => {
  const g = parseSkillGating({ requires: "stream.enabled" });
  assert.equal(
    isSkillEligible({
      gating: g,
      view: "owner",
      satisfiedRequirements: ["stream.enabled"],
    }),
    true,
  );
  assert.equal(
    isSkillEligible({ gating: g, view: "owner", satisfiedRequirements: [] }),
    false,
  );
});

test("absent capability/requires impose no restriction", () => {
  const g = parseSkillGating({ view: "public" });
  assert.equal(
    isSkillEligible({
      gating: g,
      view: "public",
      permissions: [],
      satisfiedRequirements: [],
    }),
    true,
  );
});

test("readSkillGating reads gating keys from a SKILL.md", () => {
  const g = readSkillGating(skillStub("trusted-secret"));
  assert.equal(g.view, "trusted");
  assert.equal(g.capability, "delegate_work");
});

test("gateSkills filters by view + capability, and the listing reflects it", () => {
  const skills = [skillStub("public-hello"), skillStub("trusted-secret")];
  const publicEligible = gateSkills({
    skills,
    view: "public",
    permissions: [],
  });
  assert.deepEqual(
    publicEligible.map((s) => s.id),
    ["public-hello"],
  );
  const ownerEligible = gateSkills({
    skills,
    view: "owner",
    permissions: ["delegate_work"],
  });
  assert.deepEqual(ownerEligible.map((s) => s.id).sort(), [
    "public-hello",
    "trusted-secret",
  ]);
  const listing = createSkillContextListing({ skills: publicEligible });
  assert.deepEqual(
    listing.map((s) => s.id),
    ["public-hello"],
  );
});

test("gateSkills excludes a malformed skill without throwing (spec §6)", () => {
  const skills = [skillStub("public-hello"), skillStub("broken")];
  let eligible;
  assert.doesNotThrow(() => {
    eligible = gateSkills({ skills, view: "owner", permissions: [] });
  });
  assert.deepEqual(
    eligible.map((s) => s.id),
    ["public-hello"],
  );
});
