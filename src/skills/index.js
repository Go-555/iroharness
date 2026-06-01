import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const parseYamlScalar = (value) => {
  const trimmed = String(value || "").trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const body = trimmed.slice(1, -1).trim();
    if (!body) return [];
    return body.split(",").map((entry) => parseYamlScalar(entry));
  }
  return trimmed;
};

export const parseSkillFrontmatter = (markdown) => {
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) {
    return Object.freeze({ frontmatter: Object.freeze({}), body: text });
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error("SKILL.md frontmatter is not closed");
  }
  const yaml = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const frontmatter = {};
  let activeKey = null;
  yaml.split(/\r?\n/).forEach((line) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && activeKey) {
      frontmatter[activeKey] = [...(frontmatter[activeKey] || []), parseYamlScalar(listItem[1])];
      return;
    }
    const pair = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!pair) {
      throw new Error(`Unsupported SKILL.md frontmatter line: ${line}`);
    }
    const [, key, rawValue = ""] = pair;
    activeKey = key;
    frontmatter[key] = rawValue.trim() ? parseYamlScalar(rawValue) : [];
  });
  return Object.freeze({ frontmatter: freezeCopy(frontmatter), body });
};

const commandNameFromSkillDir = (skillDir) => basename(skillDir);

const frontmatterValue = (frontmatter, key, fallback = null) =>
  Object.prototype.hasOwnProperty.call(frontmatter, key) ? frontmatter[key] : fallback;

const frontmatterArray = (frontmatter, key) => {
  const value = frontmatterValue(frontmatter, key, []);
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return [];
};

const inferPurpose = ({ id, frontmatter }) =>
  frontmatterValue(frontmatter, "purpose") ||
  (id.startsWith("ref-")
    ? "knowledge"
    : id.startsWith("eval-") || id.includes("-evaluator")
      ? "judge"
      : id.startsWith("delegate-")
        ? "pass-through"
        : "produce");

const inferShape = ({ frontmatter }) =>
  frontmatterValue(frontmatter, "shape") ||
  (frontmatterValue(frontmatter, "context") === "fork" ? "forked" : "atomic");

const inferRole = ({ id, frontmatter }) =>
  frontmatterValue(frontmatter, "role") ||
  (id.startsWith("ref-")
    ? "dictionary"
    : id.startsWith("eval-") || id.includes("-evaluator")
      ? "evaluator"
      : id.includes("-generator") || id.startsWith("run-") || id.startsWith("wrap-")
        ? "generator"
        : id.startsWith("delegate-")
          ? "delegate"
          : "workflow");

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

const sourceRootDir = () => resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const defaultBuiltInSkillDir = () => join(sourceRootDir(), "skills");

export const stackChanAvatarPackSpec = Object.freeze({
  requiredFiles: REQUIRED_STACKCHAN_AVATAR_FILES,
  mouthOverlays: STACKCHAN_MOUTH_OVERLAYS,
  width: 320,
  height: 240
});

export const defaultIroHarnessSkillDir = () =>
  process.env.IROHARNESS_SKILLS_DIR || join(homedir(), ".iroharness", "skills");

const skillManifestFromFrontmatter = ({ frontmatter, body, skillDir, manifestPath }) => {
  const id = String(frontmatter.name || commandNameFromSkillDir(skillDir));
  const context = frontmatterValue(frontmatter, "context");
  const userInvocable = frontmatterValue(frontmatter, "user-invocable", true);
  const disableModelInvocation = frontmatterValue(frontmatter, "disable-model-invocation", false);
  return normalizeSkillManifest({
    id,
    name: id,
    version: String(frontmatterValue(frontmatter, "version", "0.1.0")),
    kind: String(frontmatterValue(frontmatter, "kind", id.startsWith("ref-") ? "reference" : "workflow")),
    prefix: String(frontmatterValue(frontmatter, "prefix", id.split("-")[0])),
    purpose: String(inferPurpose({ id, frontmatter })),
    trigger: String(frontmatter.description || frontmatterValue(frontmatter, "trigger", "")),
    shape: String(inferShape({ frontmatter })),
    role: String(inferRole({ id, frontmatter })),
    description: String(frontmatter.description || frontmatterValue(frontmatter, "trigger", "")),
    userInvocable,
    inputs: freezeArray(frontmatterArray(frontmatter, "inputs")),
    outputs: freezeArray(frontmatterArray(frontmatter, "outputs")),
    references: freezeArray(frontmatterArray(frontmatter, "references")),
    evaluator: frontmatterValue(frontmatter, "evaluator") || frontmatterValue(frontmatter, "pair"),
    implementation: freezeCopy(frontmatterValue(frontmatter, "implementation", {})),
    metadata: {
      frontmatter,
      bodyPreview: body.slice(0, 160),
      context,
      disableModelInvocation,
      argumentHint: frontmatterValue(frontmatter, "argument-hint"),
      allowedTools: freezeArray(frontmatterArray(frontmatter, "allowed-tools")),
      agent: frontmatterValue(frontmatter, "agent"),
      model: frontmatterValue(frontmatter, "model"),
      base: frontmatterValue(frontmatter, "base"),
      pair: frontmatterValue(frontmatter, "pair"),
      skillDir,
      manifestPath,
      manifestFormat: "skill-md"
    }
  });
};

const readSkillMarkdownManifest = (manifestPath) => {
  const markdown = readFileSync(manifestPath, "utf8");
  const { frontmatter, body } = parseSkillFrontmatter(markdown);
  if (!frontmatter.name && !frontmatter.description) {
    throw new Error(`SKILL.md frontmatter must include name or description: ${manifestPath}`);
  }
  return skillManifestFromFrontmatter({
    frontmatter,
    body,
    skillDir: dirname(manifestPath),
    manifestPath
  });
};

const readSkillDirManifests = (skillDir) => {
  if (!skillDir || !existsSync(skillDir)) return [];
  return readdirSync(skillDir)
    .map((entry) => join(skillDir, entry))
    .filter((entryPath) => statSync(entryPath).isDirectory())
    .map((entryPath) => join(entryPath, "SKILL.md"))
    .filter((manifestPath) => existsSync(manifestPath))
    .map(readSkillMarkdownManifest);
};

export const builtInSkillManifests = () => freezeArray(readSkillDirManifests(defaultBuiltInSkillDir()));

export const createFileSkillRegistry = ({
  path = null,
  skillDirs = [defaultIroHarnessSkillDir()],
  builtIns = builtInSkillManifests()
}) => {
  const registryPath = path;
  const snapshot = () => {
    const directorySkills = skillDirs.flatMap(readSkillDirManifests);
    const skillsById = new Map();
    builtIns.map(normalizeSkillManifest).forEach((skill) => skillsById.set(skill.id, skill));
    directorySkills.forEach((skill) => skillsById.set(skill.id, skill));
    return Object.freeze({
      path: registryPath,
      skillDirs: freezeArray(skillDirs),
      skills: Object.freeze([...skillsById.values()].sort((left, right) => left.id.localeCompare(right.id)))
    });
  };
  const list = () => snapshot().skills;
  const get = (id) => list().find((skill) => skill.id === id || skill.name === id) || null;
  const register = (skill) => {
    const targetSkillDir = skillDirs[0];
    if (!targetSkillDir) throw new Error("skill directory is required to register skills");
    const manifest = normalizeSkillManifest(skill);
    const manifestDir = join(targetSkillDir, manifest.id);
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "SKILL.md"),
      `---\nname: ${manifest.id}\ndescription: ${manifest.description}\nkind: ${manifest.kind}\npurpose: ${manifest.purpose}\nshape: ${manifest.shape}\nrole: ${manifest.role}\nuser-invocable: ${manifest.userInvocable}\n---\n\n# ${manifest.name}\n`,
      "utf8"
    );
    return manifest;
  };
  return Object.freeze({ path: registryPath, snapshot, list, get, register });
};

const listSkillResources = (skillDir) => {
  if (!skillDir || !existsSync(skillDir)) return [];
  return readdirSync(skillDir)
    .filter((entry) => entry !== "SKILL.md")
    .map((entry) => {
      const path = join(skillDir, entry);
      const type = statSync(path).isDirectory() ? "directory" : "file";
      return Object.freeze({ name: entry, path, type });
    });
};

export const createSkillContextListing = ({ skills }) =>
  freezeArray(skills)
    .filter((skill) => skill.metadata.disableModelInvocation !== true)
    .map((skill) =>
      Object.freeze({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        userInvocable: skill.userInvocable,
        argumentHint: skill.metadata.argumentHint || null
      })
    );

export const readSkillInvocationContext = ({ skill }) => {
  const manifestPath = skill?.metadata?.manifestPath;
  if (!manifestPath) throw new Error(`skill manifestPath is required: ${skill?.id || "(missing)"}`);
  const { frontmatter, body } = parseSkillFrontmatter(readFileSync(manifestPath, "utf8"));
  return Object.freeze({
    id: skill.id,
    name: skill.name,
    frontmatter,
    body,
    execution: Object.freeze({
      context: frontmatterValue(frontmatter, "context"),
      fork: frontmatterValue(frontmatter, "context") === "fork",
      agent: frontmatterValue(frontmatter, "agent"),
      model: frontmatterValue(frontmatter, "model"),
      allowedTools: freezeArray(frontmatterArray(frontmatter, "allowed-tools"))
    }),
    skillDir: skill.metadata.skillDir,
    resources: freezeArray(listSkillResources(skill.metadata.skillDir))
  });
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
