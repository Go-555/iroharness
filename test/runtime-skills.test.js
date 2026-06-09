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
    ...(permissionsFor
      ? {
          permissionPolicy: {
            evaluate: () => ({ allowed: true }),
            permissionsFor,
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

  const fan = buildHarness({ skills: buildSkills(entries), role: "fan" });
  await receiveAs(fan.harness, "fan");
  assert.deepEqual(skillIds(fan.brain), ["pub"]);

  const anon = buildHarness({ skills: buildSkills(entries) });
  await receiveAs(anon.harness, null);
  assert.deepEqual(skillIds(anon.brain), ["pub"]);
});

test("capability gates within a view; requires-gated skills are excluded this phase", async () => {
  const entries = [
    ["pub", "view: public\n"],
    ["trust-cap", "view: trusted\ncapability: delegate_work\n"],
    ["needs-req", "view: public\nrequires: stream.enabled\n"],
  ];
  const permissionsFor = (user) =>
    user.role === "developer" ? ["delegate_work"] : [];

  const dev = buildHarness({
    skills: buildSkills(entries),
    role: "developer",
    permissionsFor,
  });
  await receiveAs(dev.harness, "developer");
  assert.deepEqual(skillIds(dev.brain), ["pub", "trust-cap"]);

  const mod = buildHarness({
    skills: buildSkills(entries),
    role: "moderator",
    permissionsFor,
  });
  await receiveAs(mod.harness, "moderator");
  assert.deepEqual(skillIds(mod.brain), ["pub"]);
});
