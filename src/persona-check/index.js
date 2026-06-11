// `iroharness persona-check` — cheap tier (persona-guard.md §5, Phase B) and
// rich tier (Phase C).
//
// Cheap tier: mechanically checks candidate responses against the SOUL.md
// `## Vocabulary Rules` section. Zero LLM calls, zero cost, CI-safe.
// Primary use: regression testing around a brain-slot model swap — run before
// the swap, run after, compare reports.
//
// Rich tier (`rich: true`): the same responses are ALSO scored by an injected
// judge brain against a rubric extracted from the character files (the
// JSAI2024 two-stage design — see judge.js). Opt-in and explicit: it runs only
// when a judge brain is injected (the CLI builds one from
// IROHARNESS_JUDGE_BRAIN_ENDPOINT); without one it refuses rather than
// silently bill or silently pass. Cost is what the operator enabled: one judge
// call per response (plus probe calls only if a real probe brain is wired).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createEchoBrain, createFileCharacterProfile } from "../index.js";
import { checkResponses } from "./checker.js";
import { extractRubric, judgeResponse } from "./judge.js";
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
  rich = false,
  judgeBrain = null,
  judgeTimeout = 30000,
} = {}) => {
  if (!PERSONA_CHECK_SLOTS.includes(slot)) {
    throw new Error(
      `persona-check: unknown slot "${slot}" (expected ${PERSONA_CHECK_SLOTS.join(" | ")})`,
    );
  }
  // Gate BEFORE any response collection: a rich run without a judge must not
  // probe anything (no silent fallback to a cheap-only pass).
  if (rich && (!judgeBrain || typeof judgeBrain.respond !== "function")) {
    throw new Error(
      "persona-check rich tier requires an injected judge brain with respond()",
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

  // Rich tier: rubric from the character files (honoring a --soul override),
  // then one judge call per response. A judge failure mid-run propagates —
  // fail loud, never a silently green report that skipped judging.
  let judge = null;
  if (rich) {
    const character = createFileCharacterProfile({ dir });
    const rubric = extractRubric({
      soul: soulText,
      identity: character.identity,
      voiceStyle: character.voiceStyle,
    });
    const results = [];
    for (const [index, response] of responses.entries()) {
      const verdict = await judgeResponse({
        brain: judgeBrain,
        rubric,
        response,
        question: response.question ?? null,
        timeout: judgeTimeout,
      });
      results.push(Object.freeze({ responseIndex: index, ...verdict }));
    }
    judge = Object.freeze({
      ok: results.every((result) => result.ok),
      rubricItems: rubric.items.length,
      results: Object.freeze(results),
    });
  }

  return Object.freeze({
    tier: rich ? "rich" : "cheap",
    slot,
    soulPath: resolvedSoulPath,
    soulFound: soulText !== null,
    sectionFound,
    skipped,
    responseSource,
    ...report,
    ...(judge ? { judge, ok: report.ok && judge.ok } : {}),
  });
};
