import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  builtInSkillManifests,
  createFileSkillRegistry,
  createStackChanAvatarPackPlan,
  evaluateStackChanAvatarPack
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
  const registry = createFileSkillRegistry({
    path: join(dir, ".iroharness", "skills.json"),
    skillDirs: []
  });

  registry.register({
    id: "ref-local-test",
    kind: "reference",
    purpose: "Local reference.",
    trigger: "Use in local tests.",
    shape: "Read-only.",
    role: "dictionary"
  });

  assert.equal(registry.get("run-stackchan-avatar-pack").name, "stackchan-avatar-pack");
  assert.equal(registry.get("ref-local-test").role, "dictionary");
});

test("file skill registry reads OpenClaw-style skill directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-skills-dir-"));
  const skillDir = join(dir, ".iroharness", "skills");
  const localSkillDir = join(skillDir, "ref-local-dir-test");
  mkdirSync(localSkillDir, { recursive: true });
  writeFileSync(
    join(localSkillDir, "skill.json"),
    `${JSON.stringify(
      {
        id: "ref-local-dir-test",
        kind: "reference",
        purpose: "Local directory reference.",
        trigger: "Use in local directory tests.",
        shape: "Read-only.",
        role: "dictionary"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const registry = createFileSkillRegistry({
    path: join(dir, ".iroharness", "skills.json"),
    skillDirs: [skillDir]
  });
  const skill = registry.get("ref-local-dir-test");

  assert.equal(skill.role, "dictionary");
  assert.equal(skill.metadata.skillDir, localSkillDir);
  assert.deepEqual(registry.snapshot().skillDirs, [skillDir]);
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
