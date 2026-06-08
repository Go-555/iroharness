import { readFileSync } from "node:fs";

// index.js re-exports this file; importing parseSkillFrontmatter here forms a cycle that Node ESM resolves via live bindings (used only at call time).
import { parseSkillFrontmatter } from "./index.js";

// View order mirrors the zone list in bin/iroharness.mjs (public < trusted < owner); keep both in sync.
const VIEW_RANK = Object.freeze({ public: 0, trusted: 1, owner: 2 });

// Mirrors normalizeVisibility in bin/iroharness.mjs: case-fold + alias-map, and
// FAIL CLOSED on anything unrecognized (absent, non-string, list, typo). Skills
// fall back to "owner" (most restrictive); sessions fall back to "public"
// (least privilege). Keep the alias map in sync with bin/iroharness.mjs.
const normalizeView = (value, fallback) => {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "public" || normalized === "external") return "public";
  if (
    normalized === "trusted" ||
    normalized === "team" ||
    normalized === "internal"
  )
    return "trusted";
  if (normalized === "owner") return "owner";
  return fallback;
};

export const parseSkillGating = (frontmatter = {}) =>
  Object.freeze({
    // Fail closed: an absent/malformed/unrecognized view becomes "owner" (most
    // restrictive). "public" must be an explicit opt-in.
    view: normalizeView(frontmatter.view, "owner"),
    capability:
      typeof frontmatter.capability === "string"
        ? frontmatter.capability
        : null,
    requires:
      typeof frontmatter.requires === "string" ? frontmatter.requires : null,
  });

export const isSkillEligible = ({
  gating,
  view = "public",
  permissions = [],
  satisfiedRequirements = [],
}) => {
  // Session falls back to least privilege (public) on anything unrecognized.
  const sessionRank = VIEW_RANK[normalizeView(view, "public")];
  const skillRank = VIEW_RANK[gating.view];
  if (sessionRank === undefined || skillRank === undefined) return false;
  if (sessionRank < skillRank) return false;
  if (gating.capability && !permissions.includes(gating.capability))
    return false;
  if (gating.requires && !satisfiedRequirements.includes(gating.requires))
    return false;
  return true;
};

export const readSkillGating = (skill) => {
  const manifestPath = skill?.metadata?.manifestPath;
  if (!manifestPath) {
    throw new Error(
      `skill manifestPath is required: ${skill?.id || "(missing)"}`,
    );
  }
  const { frontmatter } = parseSkillFrontmatter(
    readFileSync(manifestPath, "utf8"),
  );
  return parseSkillGating(frontmatter);
};

export const gateSkills = ({
  skills,
  view = "public",
  permissions = [],
  satisfiedRequirements = [],
}) =>
  Object.freeze(
    skills.filter((skill) => {
      let gating;
      try {
        gating = readSkillGating(skill);
      } catch (error) {
        console.warn(
          `[skills] skipping unreadable skill ${skill?.id || "(unknown)"}: ${error.message}`,
        );
        return false;
      }
      return isSkillEligible({
        gating,
        view,
        permissions,
        satisfiedRequirements,
      });
    }),
  );
