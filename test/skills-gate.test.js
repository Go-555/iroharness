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

test("parseSkillGating fails closed: absent view => owner, capability/requires=null", () => {
  const g = parseSkillGating({});
  assert.equal(g.view, "owner");
  assert.equal(g.capability, null);
  assert.equal(g.requires, null);
});

test("parseSkillGating fails closed on malformed/unknown view => owner", () => {
  assert.equal(parseSkillGating({ view: [] }).view, "owner"); // YAML `view:` (empty)
  assert.equal(parseSkillGating({ view: ["a", "b"] }).view, "owner"); // multi-item list
  assert.equal(parseSkillGating({ view: "secret" }).view, "owner"); // unknown value
  assert.equal(parseSkillGating({ view: 123 }).view, "owner"); // non-string
});

test("parseSkillGating normalizes case and aliases (matches normalizeVisibility)", () => {
  assert.equal(parseSkillGating({ view: "Trusted" }).view, "trusted");
  assert.equal(parseSkillGating({ view: "PUBLIC" }).view, "public");
  assert.equal(parseSkillGating({ view: "external" }).view, "public");
  assert.equal(parseSkillGating({ view: "internal" }).view, "trusted");
  assert.equal(parseSkillGating({ view: "team" }).view, "trusted");
  assert.equal(parseSkillGating({ view: ["trusted"] }).view, "trusted"); // single-item list resolves
});

test("owner-only skill is denied to a trusted session (top-tier boundary)", () => {
  const ownerSkill = parseSkillGating({ view: "owner" });
  assert.equal(isSkillEligible({ gating: ownerSkill, view: "trusted" }), false);
  assert.equal(isSkillEligible({ gating: ownerSkill, view: "owner" }), true);
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

test("an unrecognized session view falls back to public (least privilege)", () => {
  const publicSkill = parseSkillGating({ view: "public" });
  const trustedSkill = parseSkillGating({ view: "trusted" });
  // garbage session view -> treated as public: sees public, not trusted
  assert.equal(
    isSkillEligible({ gating: publicSkill, view: "nonsense" }),
    true,
  );
  assert.equal(
    isSkillEligible({ gating: trustedSkill, view: "nonsense" }),
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

test("the ./skills entry exposes the gate", async () => {
  const mod = await import("iroharness/skills");
  assert.equal(typeof mod.gateSkills, "function");
  assert.equal(typeof mod.isSkillEligible, "function");
  assert.equal(typeof mod.parseSkillGating, "function");
});

test("view passes but capability fails -> excluded (AND composition)", () => {
  const g = parseSkillGating({ view: "trusted", capability: "delegate_work" });
  // owner session clears the view gate, but lacks the capability
  assert.equal(
    isSkillEligible({ gating: g, view: "owner", permissions: [] }),
    false,
  );
  // ...and with the capability, it passes
  assert.equal(
    isSkillEligible({
      gating: g,
      view: "owner",
      permissions: ["delegate_work"],
    }),
    true,
  );
});
