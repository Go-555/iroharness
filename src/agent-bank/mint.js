// mint_specialist (Phase 3.1): turn a task into a fresh staging recipe.
// `generate` is injected (an LLM call in production, a stub in tests) and returns
// a draft { id, role, prompt, toolset }. The draft is NEVER trusted as-is:
// - its toolset is intersected with the staging allowlist (B-1), and
// - no visibility is written (staging folder is the authority; never owner).
// assertStagingSafe is the final gate before the recipe is written.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertStagingSafe } from "./staging-guard.js";
import { intersectToolset } from "./tool-policy.js";

export const mintSpecialist = ({ root, task, allowlist = [], generate }) => {
  const draft = generate(task);
  if (!draft || !draft.id) {
    throw new Error("generated draft is missing id");
  }

  const toolset = intersectToolset(draft.toolset, allowlist);
  assertStagingSafe({ toolset, visibility: undefined, allowlist });

  const md = [
    "---",
    `id: ${draft.id}`,
    `role: ${draft.role || draft.id}`,
    `toolset: [${toolset.join(", ")}]`,
    "source: minted",
    "---",
    "",
    draft.prompt || "",
    "",
  ].join("\n");

  const dir = join(root, "staging", draft.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "recipe.md"), md);

  return { id: draft.id, status: "staging", toolset };
};
