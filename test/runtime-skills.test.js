import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createFileSkillRegistry } from "../src/skills/index.js";
import {
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
  createStubMicroHarness,
} from "../src/index.js";

const createCapturingBrain = (id) => {
  let captured = null;
  return {
    id,
    async respond(context) {
      captured = context;
      return { text: "ok", emotion: "focused" };
    },
    captured: () => captured,
  };
};

const buildSkills = (entries) => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-runtime-skills-"));
  for (const [id, frontmatter] of entries) {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(
      join(dir, id, "SKILL.md"),
      `---\nname: ${id}\ndescription: ${id} skill.\n${frontmatter}---\n\n# ${id}\n`,
      "utf8",
    );
  }
  return createFileSkillRegistry({ skillDirs: [dir], builtIns: [] });
};

const buildHarness = ({
  skills = null,
  role = null,
  permissionsFor = null,
  microHarnesses = [],
  satisfiedRequirements = undefined,
} = {}) => {
  const userRegistry = createInMemoryUserRegistry();
  if (role) {
    userRegistry.registerUser({
      id: role,
      displayName: role,
      role,
      identities: { web: role.toUpperCase() },
    });
  }
  const brain = createCapturingBrain("capture");
  const harness = createIroHarness({
    character: { id: "iroha", name: "Iroha", soul: "x", voiceStyle: "short" },
    projectOs: createInMemoryProjectOs(),
    userRegistry,
    brains: { voice: brain, text: brain },
    skills,
    microHarnesses,
    ...(satisfiedRequirements !== undefined ? { satisfiedRequirements } : {}),
    ...(permissionsFor
      ? {
          permissionPolicy: {
            evaluate: () => ({ allowed: true }),
            permissionsFor,
            createContextScopes: () => Object.freeze([]),
          },
        }
      : {}),
  });
  return { harness, brain, role };
};

const receiveAs = (harness, role) =>
  harness.receive({
    source: "web",
    modality: "text",
    text: "hi",
    ...(role
      ? { actor: { platform: "web", platformUserId: role.toUpperCase() } }
      : {}),
  });

const skillIds = (brain) =>
  (brain.captured().skills || []).map((s) => s.id).sort();

test("owner sees all skills; a no-skills harness passes an empty listing", async () => {
  const skills = buildSkills([
    ["pub", "view: public\n"],
    ["trust", "view: trusted\n"],
    ["own", "view: owner\n"],
  ]);
  const { harness, brain } = buildHarness({ skills, role: "owner" });
  await receiveAs(harness, "owner");
  assert.deepEqual(skillIds(brain), ["own", "pub", "trust"]);

  const bare = buildHarness({ role: "owner" });
  await receiveAs(bare.harness, "owner");
  assert.deepEqual(bare.brain.captured().skills, []);
});

test("tier maps to view: developer/moderator see trusted, fan and anonymous see public only", async () => {
  const entries = [
    ["pub", "view: public\n"],
    ["trust", "view: trusted\n"],
    ["own", "view: owner\n"],
  ];

  const dev = buildHarness({ skills: buildSkills(entries), role: "developer" });
  await receiveAs(dev.harness, "developer");
  assert.deepEqual(skillIds(dev.brain), ["pub", "trust"]);

  const mod = buildHarness({ skills: buildSkills(entries), role: "moderator" });
  await receiveAs(mod.harness, "moderator");
  assert.deepEqual(skillIds(mod.brain), ["pub", "trust"]);

  const member = buildHarness({ skills: buildSkills(entries), role: "member" });
  await receiveAs(member.harness, "member");
  assert.deepEqual(skillIds(member.brain), ["pub"]); // member -> public (not operator)

  const fan = buildHarness({ skills: buildSkills(entries), role: "fan" });
  await receiveAs(fan.harness, "fan");
  assert.deepEqual(skillIds(fan.brain), ["pub"]);

  const anon = buildHarness({ skills: buildSkills(entries) });
  await receiveAs(anon.harness, null);
  assert.deepEqual(skillIds(anon.brain), ["pub"]);
});

test("capability gates within a view; requires-gated skills are excluded by default (no satisfiedRequirements)", async () => {
  const entries = [
    ["pub", "view: public\n"],
    ["trust-cap", "view: trusted\ncapability: delegate_work\n"],
    // requires on a TRUSTED skill: a developer clears the trusted view AND has
    // delegate_work, yet this is still excluded — proving `requires` gates
    // independently of the view/capability gates when nothing is satisfied.
    ["needs-req", "view: trusted\nrequires: stream.enabled\n"],
  ];
  const permissionsFor = (user) =>
    user.role === "developer" ? ["delegate_work"] : [];

  const dev = buildHarness({
    skills: buildSkills(entries),
    role: "developer",
    permissionsFor,
  });
  await receiveAs(dev.harness, "developer");
  // needs-req excluded despite clearing trusted view (requires fail-closed).
  assert.deepEqual(skillIds(dev.brain), ["pub", "trust-cap"]);

  const mod = buildHarness({
    skills: buildSkills(entries),
    role: "moderator",
    permissionsFor,
  });
  await receiveAs(mod.harness, "moderator");
  assert.deepEqual(skillIds(mod.brain), ["pub"]);
});

// ─── requires gating: satisfiedRequirements (static array + resolver) ─────────

const reqEntries = [
  ["pub", "view: public\n"],
  ["needs-req", "view: trusted\nrequires: stream.enabled\n"],
];

test("a requires-gated skill is excluded when its requirement is not satisfied", async () => {
  const { harness, brain } = buildHarness({
    skills: buildSkills(reqEntries),
    role: "developer",
  });
  await receiveAs(harness, "developer");
  assert.deepEqual(skillIds(brain), ["pub"]); // needs-req excluded (default: none satisfied)
});

test("a requires-gated skill is included when satisfiedRequirements (static array) lists it", async () => {
  const { harness, brain } = buildHarness({
    skills: buildSkills(reqEntries),
    role: "developer",
    satisfiedRequirements: ["stream.enabled"],
  });
  await receiveAs(harness, "developer");
  assert.deepEqual(skillIds(brain), ["needs-req", "pub"]);
});

test("satisfiedRequirements may be a resolver — included when the resolver returns the requirement", async () => {
  const { harness, brain } = buildHarness({
    skills: buildSkills(reqEntries),
    role: "developer",
    satisfiedRequirements: () => ["stream.enabled"],
  });
  await receiveAs(harness, "developer");
  assert.deepEqual(skillIds(brain), ["needs-req", "pub"]);
});

test("the resolver receives the turn context (input/actor/route/audience/state/permissions/contextScopes)", async () => {
  let seen = null;
  const { harness } = buildHarness({
    skills: buildSkills(reqEntries),
    role: "developer",
    satisfiedRequirements: (ctx) => {
      seen = ctx;
      return [];
    },
  });
  await receiveAs(harness, "developer");
  assert.ok(seen);
  assert.deepEqual(Object.keys(seen).sort(), [
    "actor",
    "audience",
    "contextScopes",
    "input",
    "permissions",
    "route",
    "state",
  ]);
  assert.equal(seen.input.text, "hi");
  assert.equal(seen.route.kind, "text");
});

test("a resolver that throws fails closed (skill excluded, turn still responds)", async () => {
  const { harness, brain } = buildHarness({
    skills: buildSkills(reqEntries),
    role: "developer",
    satisfiedRequirements: () => {
      throw new Error("boom");
    },
  });
  const result = await receiveAs(harness, "developer");
  assert.equal(result.kind, "response"); // the turn survives
  assert.deepEqual(skillIds(brain), ["pub"]); // needs-req excluded (fail-closed)
});

test("a resolver that returns a non-array fails closed (skill excluded)", async () => {
  const { harness, brain } = buildHarness({
    skills: buildSkills(reqEntries),
    role: "developer",
    satisfiedRequirements: () => "stream.enabled", // a string, not an array
  });
  await receiveAs(harness, "developer");
  assert.deepEqual(skillIds(brain), ["pub"]); // treated as none satisfied
});

test("the work (micro-harness) path does not run skill gating", async () => {
  // A work route returns via runMicroHarness before brain.respond, so the
  // capturing brain is never called and no skill listing is computed.
  // (Stream routes are excluded for the same reason — both early-return
  // before the brain path where gateSkills runs.)
  const { harness, brain } = buildHarness({
    skills: buildSkills([["pub", "view: public\n"]]),
    role: "developer",
    permissionsFor: () => ["delegate_work"],
    microHarnesses: [createStubMicroHarness("codex", ["code"])],
  });
  const result = await harness.receive({
    source: "web",
    modality: "text",
    text: "Codexでこのコードをレビューして",
    actor: { platform: "web", platformUserId: "DEVELOPER" },
  });

  assert.equal(result.kind, "delegation");
  assert.equal(result.route.kind, "work");
  assert.equal(brain.captured(), null);
});
