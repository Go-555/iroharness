// mint_specialist (Phase 3.1): turn a task into a fresh staging recipe.
// `generate` is injected (an LLM call in production, a stub in tests) and
// returns a draft { id, role, prompt, toolset, visibility? }. The draft is LLM
// output and is NEVER trusted:
// - its id goes through assertValidRecipeId before becoming a path segment,
// - frontmatter scalars are rejected if they could inject extra lines (the
//   recipe parser is last-wins per key, so a smuggled "\nid: x" would rewrite
//   identity),
// - its toolset is intersected with the staging allowlist (B-1), and
// - assertStagingSafe is the final gate (owner visibility / vault tools /
//   allowlist escapes) before anything is written.
// Origin authority: mint does NOT touch the seed manifest, so originOf()
// reports "minted" (fail-safe). The `source: minted` frontmatter line below is
// advisory only — the parser quarantines it into `declared`.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertValidRecipeId } from "./registry.js";
import { assertStagingSafe } from "./staging-guard.js";
import { intersectToolset } from "./tool-policy.js";

// A frontmatter scalar must stay on its own line. Newlines / carriage returns
// (and other C0 control chars) would let a generated value append arbitrary
// frontmatter lines, so they are rejected outright rather than silently
// rewritten.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const assertFrontmatterScalar = (field, value) => {
  if (typeof value !== "string" || CONTROL_CHARS.test(value)) {
    throw new Error(
      `generated ${field} must be a single-line string without control characters`,
    );
  }
  return value;
};

export const mintSpecialist = ({ root, task, allowlist = [], generate }) => {
  const draft = generate(task);
  if (!draft || !draft.id) {
    throw new Error("generated draft is missing id");
  }
  // ajimi handoff: the id is LLM-generated and becomes a path segment — same
  // whitelist validator as every other id entry point (traversal is rejected).
  assertValidRecipeId(draft.id);

  const role = assertFrontmatterScalar("role", draft.role ?? draft.id);
  const prompt = draft.prompt ?? "";
  if (typeof prompt !== "string") {
    throw new Error("generated prompt must be a string");
  }

  // B-1: strip anything outside the staging allowlist, then run the bantou
  // gate. The draft's requested visibility is passed through so an
  // owner-visibility grab is refused; vault tools are refused even if a
  // tainted allowlist contains them. Nothing is written unless this passes.
  // ajimi: an entry containing list delimiters would survive the intersection
  // as ONE tool (when a tainted allowlist holds it verbatim) but round-trip
  // through the `toolset: [a, b]` frontmatter join as SEVERAL tools — e.g.
  // "doc-read, vault" parses back as doc-read AND vault. Reject outright.
  const TOOLSET_DELIMITERS = /[,[\]]/;
  const toolset = intersectToolset(draft.toolset, allowlist).map((tool) => {
    assertFrontmatterScalar("toolset entry", tool);
    if (TOOLSET_DELIMITERS.test(tool)) {
      throw new Error(
        `generated toolset entry must not contain list delimiters (',', '[', ']'): ${tool}`,
      );
    }
    return tool;
  });
  assertStagingSafe({ toolset, visibility: draft.visibility, allowlist });

  const md = [
    "---",
    `id: ${draft.id}`,
    `role: ${role}`,
    `toolset: [${toolset.join(", ")}]`,
    "source: minted",
    "---",
    "",
    prompt,
    "",
  ].join("\n");

  const dir = join(root, "staging", draft.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "recipe.md"), md);

  return { id: draft.id, status: "staging", toolset };
};
