import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const REQUIRED_STACKCHAN_AVATAR_FILES = Object.freeze([
  "neutral.png",
  "neutral_blink.png",
  "joy.png",
  "fun.png",
  "angry.png",
  "sorrow.png",
  "mouth_half.png",
  "mouth_open.png"
]);

const STACKCHAN_MOUTH_OVERLAYS = Object.freeze(["mouth_half.png", "mouth_open.png"]);

const freezeCopy = (value) => Object.freeze({ ...value });

const freezeArray = (value = []) => Object.freeze([...value]);

const normalizeSkillManifest = (skill) => {
  if (!skill?.id) throw new Error("skill.id is required");
  if (!skill?.kind) throw new Error(`skill.kind is required: ${skill.id}`);
  if (!skill?.purpose) throw new Error(`skill.purpose is required: ${skill.id}`);
  if (!skill?.trigger) throw new Error(`skill.trigger is required: ${skill.id}`);
  if (!skill?.shape) throw new Error(`skill.shape is required: ${skill.id}`);
  if (!skill?.role) throw new Error(`skill.role is required: ${skill.id}`);
  return Object.freeze({
    id: skill.id,
    name: skill.name || skill.id,
    version: skill.version || "0.1.0",
    kind: skill.kind,
    prefix: skill.prefix || skill.id.split("-")[0],
    purpose: skill.purpose,
    trigger: skill.trigger,
    shape: skill.shape,
    role: skill.role,
    description: skill.description || skill.trigger,
    userInvocable: skill.userInvocable !== false,
    inputs: freezeArray(skill.inputs),
    outputs: freezeArray(skill.outputs),
    references: freezeArray(skill.references),
    evaluator: skill.evaluator || null,
    implementation: freezeCopy(skill.implementation || {}),
    metadata: freezeCopy(skill.metadata || {})
  });
};

const BUILT_IN_SKILLS = Object.freeze([
  normalizeSkillManifest({
    id: "ref-stackchan-avatar-spec",
    kind: "reference",
    prefix: "ref",
    purpose: "Describe the required StackChan avatar file contract.",
    trigger: "Use when checking StackChan avatar file names, dimensions, or mouth overlay rules.",
    shape: "Read-only reference. No files are modified.",
    role: "dictionary",
    userInvocable: false,
    outputs: ["avatar-spec"],
    references: ["skills/stackchan-avatar-pack/references/stackchan-avatar-spec.md"]
  }),
  normalizeSkillManifest({
    id: "eval-stackchan-avatar-pack",
    kind: "workflow",
    prefix: "eval",
    purpose: "Validate a generated StackChan avatar pack before provisioning.",
    trigger: "Use when reviewing a StackChan avatar pack artifact.",
    shape: "Reads an avatar directory and returns deterministic checks.",
    role: "evaluator",
    inputs: ["packDir"],
    outputs: ["validation-report"],
    references: ["skills/stackchan-avatar-pack/references/stackchan-avatar-spec.md"],
    implementation: {
      cli: "iroharness skill eval stackchan-avatar-pack <dir> --pack-dir <pack-dir>"
    }
  }),
  normalizeSkillManifest({
    id: "run-stackchan-avatar-pack",
    name: "stackchan-avatar-pack",
    kind: "workflow",
    prefix: "run",
    purpose: "Turn one reference image into a reviewed StackChan avatar pack.",
    trigger: "Use when creating a StackChan avatar pack from a reference image.",
    shape: "Creates a plan artifact; generation should be executed by an image-capable runner.",
    role: "generator",
    inputs: ["referenceImage", "packId", "characterName", "direction"],
    outputs: ["avatar-pack-plan", "avatar-pack"],
    references: [
      "skills/stackchan-avatar-pack/SKILL.md",
      "skills/stackchan-avatar-pack/references/stackchan-avatar-spec.md"
    ],
    evaluator: "eval-stackchan-avatar-pack",
    implementation: {
      cli: "iroharness skill plan stackchan-avatar-pack <dir> --reference-image <path>"
    }
  })
]);

export const stackChanAvatarPackSpec = Object.freeze({
  requiredFiles: REQUIRED_STACKCHAN_AVATAR_FILES,
  mouthOverlays: STACKCHAN_MOUTH_OVERLAYS,
  width: 320,
  height: 240
});

export const builtInSkillManifests = () => freezeArray(BUILT_IN_SKILLS);

export const createFileSkillRegistry = ({ path, builtIns = builtInSkillManifests() }) => {
  const registryPath = path;
  const readProjectSkills = () => {
    if (!registryPath || !existsSync(registryPath)) return [];
    const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
    return freezeArray(parsed.skills || []);
  };
  const snapshot = () => {
    const projectSkills = readProjectSkills().map(normalizeSkillManifest);
    const skillsById = new Map();
    builtIns.map(normalizeSkillManifest).forEach((skill) => skillsById.set(skill.id, skill));
    projectSkills.forEach((skill) => skillsById.set(skill.id, skill));
    return Object.freeze({
      path: registryPath,
      skills: Object.freeze([...skillsById.values()].sort((left, right) => left.id.localeCompare(right.id)))
    });
  };
  const list = () => snapshot().skills;
  const get = (id) => list().find((skill) => skill.id === id || skill.name === id) || null;
  const register = (skill) => {
    if (!registryPath) throw new Error("registry path is required to register skills");
    const manifest = normalizeSkillManifest(skill);
    const existing = readProjectSkills().filter((candidate) => candidate.id !== manifest.id);
    mkdirSync(dirname(registryPath), { recursive: true });
    writeFileSync(
      registryPath,
      `${JSON.stringify({ skills: [...existing, manifest] }, null, 2)}\n`,
      "utf8"
    );
    return manifest;
  };
  return Object.freeze({ path: registryPath, snapshot, list, get, register });
};

const defaultPackId = (referenceImage) =>
  basename(String(referenceImage || "stackchan-avatar"), /\.[^.]+$/)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "stackchan-avatar";

export const createStackChanAvatarPackPlan = ({
  referenceImage,
  outputDir,
  packId = defaultPackId(referenceImage),
  characterName = "Iroha",
  direction = ""
}) => {
  if (!referenceImage) throw new Error("referenceImage is required");
  const resolvedReferenceImage = resolve(referenceImage);
  const resolvedOutputDir = resolve(outputDir || join(".iroharness", "artifacts", "avatar-packs", packId));
  return Object.freeze({
    skillId: "run-stackchan-avatar-pack",
    evaluator: "eval-stackchan-avatar-pack",
    packId,
    characterName,
    referenceImage: resolvedReferenceImage,
    outputDir: resolvedOutputDir,
    avatarDir: join(resolvedOutputDir, "avatar"),
    previewPath: join(resolvedOutputDir, "preview", "contact-sheet.png"),
    direction,
    requiredFiles: REQUIRED_STACKCHAN_AVATAR_FILES,
    phases: Object.freeze([
      {
        id: "base-face",
        owner: "generator",
        done: "A reviewed neutral base face exists and preserves the requested character direction."
      },
      {
        id: "face-expressions",
        owner: "generator",
        done: "neutral_blink, joy, fun, angry, and sorrow are full 320x240 face PNGs."
      },
      {
        id: "mouth-overlays",
        owner: "generator",
        done: "mouth_half and mouth_open are transparent mouth-only overlays aligned against neutral."
      },
      {
        id: "deterministic-eval",
        owner: "evaluator",
        done: "All files pass dimension and alpha checks without changing the criteria."
      },
      {
        id: "provision",
        owner: "runner",
        done: "Approved files are copied into firmware data/avatar and uploadfs is run only after review."
      }
    ])
  });
};

const readPngInfo = (path) => {
  const buffer = readFileSync(path);
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 33 || buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("not a PNG file");
  }
  return Object.freeze({
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer.readUInt8(24),
    colorType: buffer.readUInt8(25),
    hasAlpha: [4, 6].includes(buffer.readUInt8(25))
  });
};

const resolveAvatarDir = (packDir) => {
  const direct = resolve(packDir);
  const nested = join(direct, "avatar");
  if (existsSync(join(direct, "neutral.png"))) return direct;
  if (existsSync(nested)) return nested;
  return direct;
};

export const evaluateStackChanAvatarPack = ({ packDir }) => {
  if (!packDir) throw new Error("packDir is required");
  const avatarDir = resolveAvatarDir(packDir);
  const checks = REQUIRED_STACKCHAN_AVATAR_FILES.flatMap((file) => {
    const path = join(avatarDir, file);
    if (!existsSync(path)) {
      return [freezeCopy({ id: `${file}:exists`, ok: false, file, path, detail: "missing" })];
    }
    try {
      const info = readPngInfo(path);
      const sizeOk = info.width === 320 && info.height === 240;
      const alphaRequired = STACKCHAN_MOUTH_OVERLAYS.includes(file);
      return [
        freezeCopy({
          id: `${file}:size`,
          ok: sizeOk,
          file,
          path,
          detail: `${info.width}x${info.height}`
        }),
        freezeCopy({
          id: `${file}:alpha`,
          ok: !alphaRequired || info.hasAlpha,
          file,
          path,
          detail: alphaRequired ? `alpha=${info.hasAlpha}` : "not-required"
        })
      ];
    } catch (error) {
      return [
        freezeCopy({
          id: `${file}:png`,
          ok: false,
          file,
          path,
          detail: error.message
        })
      ];
    }
  });
  return Object.freeze({
    ok: checks.every((check) => check.ok),
    packDir: resolve(packDir),
    avatarDir,
    requiredFiles: REQUIRED_STACKCHAN_AVATAR_FILES,
    checks: Object.freeze(checks)
  });
};
