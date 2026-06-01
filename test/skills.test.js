import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  builtInSkillManifests,
  createSkillContextListing,
  createFileSkillRegistry,
  createStackChanAvatarPackPlan,
  evaluateStackChanAvatarPack,
  parseSkillFrontmatter,
  readSkillInvocationContext
} from "../src/skills/index.js";

const pngHeader = ({ width = 320, height = 240, colorType = 2 }) => {
  const buffer = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer.writeUInt8(8, 24);
  buffer.writeUInt8(colorType, 25);
  return buffer;
};

test("built-in skills separate reference, generator, and evaluator roles", () => {
  const skills = builtInSkillManifests();

  assert.equal(skills.some((skill) => skill.id === "ref-stackchan-avatar-spec"), true);
  assert.equal(skills.some((skill) => skill.id === "run-stackchan-avatar-pack"), true);
  assert.equal(skills.some((skill) => skill.id === "eval-stackchan-avatar-pack"), true);
  assert.equal(
    skills.find((skill) => skill.id === "run-stackchan-avatar-pack").evaluator,
    "eval-stackchan-avatar-pack"
  );
});

test("file skill registry overlays project skills on built-ins", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-skills-"));
  const skillDir = join(dir, ".iroharness", "skills");
  const registry = createFileSkillRegistry({
    path: null,
    skillDirs: [skillDir]
  });

  registry.register({
    id: "ref-local-test",
    kind: "reference",
    purpose: "Local reference.",
    trigger: "Use in local tests.",
    shape: "Read-only.",
    role: "dictionary"
  });

  assert.equal(registry.get("run-stackchan-avatar-pack").name, "run-stackchan-avatar-pack");
  assert.equal(registry.get("ref-local-test").role, "dictionary");
});

test("file skill registry reads OpenClaw-style skill directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-skills-dir-"));
  const skillDir = join(dir, ".iroharness", "skills");
  const localSkillDir = join(skillDir, "ref-local-dir-test");
  const referencesDir = join(localSkillDir, "references");
  mkdirSync(localSkillDir, { recursive: true });
  mkdirSync(referencesDir, { recursive: true });
  writeFileSync(
    join(localSkillDir, "SKILL.md"),
    `---\nname: ref-local-dir-test\ndescription: Use in local directory tests.\nkind: reference\npurpose: knowledge\nshape: atomic\nrole: dictionary\nuser-invocable: false\ndisable-model-invocation: true\n---\n\n# Local directory reference\n\nRead references only when needed.\n`,
    "utf8"
  );
  writeFileSync(join(referencesDir, "details.md"), "details\n", "utf8");

  const registry = createFileSkillRegistry({
    path: null,
    skillDirs: [skillDir]
  });
  const skill = registry.get("ref-local-dir-test");

  assert.equal(skill.role, "dictionary");
  assert.equal(skill.metadata.skillDir, localSkillDir);
  assert.equal(skill.metadata.manifestFormat, "skill-md");
  assert.deepEqual(registry.snapshot().skillDirs, [skillDir]);
  assert.equal(createSkillContextListing({ skills: registry.list() }).some((entry) => entry.id === skill.id), false);

  const invocation = readSkillInvocationContext({ skill });

  assert.match(invocation.body, /Local directory reference/);
  assert.equal(invocation.resources.some((resource) => resource.name === "references"), true);
});

test("skill frontmatter parser supports Claude Code fields", () => {
  const parsed = parseSkillFrontmatter(
    `---\nname: eval-demo\ndescription: Use when evaluating demo artifacts.\ncontext: fork\nallowed-tools:\n  - Read\n  - Grep\nuser-invocable: false\n---\n\n# Eval Demo\n`
  );

  assert.equal(parsed.frontmatter.name, "eval-demo");
  assert.equal(parsed.frontmatter.context, "fork");
  assert.deepEqual(parsed.frontmatter["allowed-tools"], ["Read", "Grep"]);
  assert.match(parsed.body, /Eval Demo/);
});

test("skill invocation context exposes fork execution metadata", () => {
  const skill = builtInSkillManifests().find((candidate) => candidate.id === "eval-stackchan-avatar-pack");
  const invocation = readSkillInvocationContext({ skill });

  assert.equal(invocation.execution.fork, true);
  assert.equal(invocation.execution.context, "fork");
  assert.deepEqual(invocation.execution.allowedTools, ["Read"]);
});

test("StackChan avatar pack plan captures generator and evaluator phases", () => {
  const plan = createStackChanAvatarPackPlan({
    referenceImage: "./iroha.png",
    outputDir: "./out/iroha",
    packId: "iroha"
  });

  assert.equal(plan.skillId, "run-stackchan-avatar-pack");
  assert.equal(plan.evaluator, "eval-stackchan-avatar-pack");
  assert.equal(plan.requiredFiles.includes("mouth_open.png"), true);
  assert.equal(plan.phases.some((phase) => phase.owner === "evaluator"), true);
});

test("StackChan avatar pack evaluator checks size and mouth overlay alpha", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-avatar-pack-"));
  const avatarDir = join(dir, "avatar");
  mkdirSync(avatarDir, { recursive: true });
  [
    "neutral.png",
    "neutral_blink.png",
    "joy.png",
    "fun.png",
    "angry.png",
    "sorrow.png"
  ].forEach((file) => writeFileSync(join(avatarDir, file), pngHeader({ colorType: 2 })));
  ["mouth_half.png", "mouth_open.png"].forEach((file) =>
    writeFileSync(join(avatarDir, file), pngHeader({ colorType: 6 }))
  );

  const result = evaluateStackChanAvatarPack({ packDir: dir });

  assert.equal(result.ok, true);
  assert.equal(result.checks.every((check) => check.ok), true);
});
