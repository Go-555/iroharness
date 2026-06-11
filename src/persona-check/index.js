// `iroharness persona-check` — cheap tier (persona-guard.md §5, Phase B).
//
// Mechanically checks candidate responses against the SOUL.md
// `## Vocabulary Rules` section. Zero LLM calls, zero cost, CI-safe.
// Primary use: regression testing around a brain-slot model swap — run before
// the swap, run after, compare reports.
//
// The rich tier (persona-guard.md §5: fixed question set against the real
// brain, rubric generation from the character files, LLM judge) is Phase C:
// opt-in, issues LLM calls, intentionally NOT implemented here.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createEchoBrain, createFileCharacterProfile } from "../index.js";
import { checkResponses } from "./checker.js";
import { parseVocabularyRules } from "./rules.js";
import {
  collectBrainResponses,
  defaultPersonaCheckQuestions,
  loadResponsesFromFile,
} from "./runner.js";

export { checkResponses } from "./checker.js";
export { extractRubric, judgeResponse } from "./judge.js";
export { parseVocabularyRules } from "./rules.js";
export {
  collectBrainResponses,
  defaultPersonaCheckQuestions,
  loadResponsesFromFile,
} from "./runner.js";

export const PERSONA_CHECK_SLOTS = Object.freeze(["voice", "text", "deep"]);

export const runPersonaCheck = async ({
  dir = ".",
  soulPath = null,
  responsesPath = null,
  slot = "text",
  brain = null,
  questions = defaultPersonaCheckQuestions,
} = {}) => {
  if (!PERSONA_CHECK_SLOTS.includes(slot)) {
    throw new Error(
      `persona-check: unknown slot "${slot}" (expected ${PERSONA_CHECK_SLOTS.join(" | ")})`,
    );
  }

  const resolvedSoulPath = soulPath || join(dir, "SOUL.md");
  const soulText = existsSync(resolvedSoulPath)
    ? readFileSync(resolvedSoulPath, "utf8")
    : null;
  const { sectionFound, rules, skipped } = parseVocabularyRules(soulText);

  let responses;
  let responseSource;
  if (responsesPath) {
    responses = loadResponsesFromFile(responsesPath);
    responseSource = `file ${responsesPath}`;
  } else {
    const character = createFileCharacterProfile({ dir });
    const probeBrain = brain || createEchoBrain("persona-check-echo");
    responses = await collectBrainResponses({
      brain: probeBrain,
      character,
      slot,
      questions,
    });
    responseSource =
      probeBrain.id === "persona-check-echo"
        ? "echo brain probe (zero cost)"
        : `brain ${probeBrain.id} probe`;
  }

  const report = checkResponses({ rules, responses });

  return Object.freeze({
    tier: "cheap",
    slot,
    soulPath: resolvedSoulPath,
    soulFound: soulText !== null,
    sectionFound,
    skipped,
    responseSource,
    ...report,
  });
};
