// Agent hook runner (extension-model.md §3.2 style 3, Phase 8): an LLM
// judgment hook for TEXT-PATH events only (the §3.5 realtime invariant rejects
// `style: "agent"` on bargein:/speech:/device: at registration).
//
// The LLM is reached exclusively through an INJECTED judge brain (standard
// brain contract, `respond(context)`); a manifest alone never connects an LLM
// (declaration vs implementation separation). With no brain injected, the hook
// follows its failMode when it fires.
//
// failMode default is "open" — a design decision, not an accident: the persona
// gate guards the character's own face, and a broken/slow/unconfigured judge
// must not mute the character (persona-guard.md §6: verification exists, but
// it must not make the face slower or mute). Operators who prefer "no unvetted
// output" opt into failMode: "closed". Note this hook-level failMode governs
// JUDGE failures; a judge that answers `ok: false` always blocks/transforms.

import { extractRubric, judgeResponse } from "../../persona-check/judge.js";

const FAIL_MODES = Object.freeze(["open", "closed"]);

// createAgentHook({ judgeBrain?, rubric? | prompt, timeout?, failMode?, model? })
//   -> async (ctx) => undefined | { block: { reason } } | { transform: { ... } }
//
// The returned handler follows the §3.4 dispatch contract and judges the
// event's text payload: `ctx.response` when present (response:before),
// otherwise `ctx.input`. A deny verdict maps to block; a rewrite verdict maps
// to a transform of the judged field (protectedKeys in dispatch still apply —
// the hook never touches `actor`).
export const createAgentHook = ({
  judgeBrain = null,
  rubric = null,
  prompt = null,
  timeout = 30000,
  failMode = "open",
  model = null,
} = {}) => {
  if (!FAIL_MODES.includes(failMode)) {
    throw new Error(
      `createAgentHook failMode must be "open" or "closed" (got ${JSON.stringify(failMode)})`,
    );
  }
  if (judgeBrain !== null && typeof judgeBrain?.respond !== "function") {
    throw new Error("createAgentHook judgeBrain must expose respond()");
  }
  let effectiveRubric;
  if (rubric !== null) {
    if (!Array.isArray(rubric.items) || rubric.items.length === 0) {
      throw new Error(
        "createAgentHook rubric must carry at least one item (rubric.items)",
      );
    }
    effectiveRubric = rubric;
  } else if (typeof prompt === "string" && prompt.trim().length > 0) {
    effectiveRubric = Object.freeze({
      items: Object.freeze([
        Object.freeze({ id: "prompt", kind: "prompt", instruction: prompt }),
      ]),
    });
  } else {
    throw new Error(
      "createAgentHook requires a rubric or a non-empty prompt string",
    );
  }

  const fail = (message) => {
    if (failMode === "closed") {
      return { block: { reason: `agent hook (fail-closed): ${message}` } };
    }
    console.warn(`[hooks] agent hook fail-open: ${message}`);
    return undefined;
  };

  return async (ctx) => {
    if (!judgeBrain) {
      return fail("judge brain not injected");
    }
    const target = ctx?.response !== undefined ? "response" : "input";
    const payload = ctx?.[target];
    const text = typeof payload === "string" ? payload : payload?.text;
    if (typeof text !== "string") {
      return fail(`no judgeable text on context field "${target}"`);
    }
    let verdict;
    try {
      verdict = await judgeResponse({
        brain: judgeBrain,
        rubric: effectiveRubric,
        response: text,
        question: target === "response" ? (ctx?.input?.text ?? null) : null,
        timeout,
        model,
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    if (verdict.ok) {
      return undefined;
    }
    if (verdict.rewrite) {
      const rewritten =
        typeof payload === "string"
          ? verdict.rewrite
          : { ...payload, text: verdict.rewrite };
      return { transform: { [target]: rewritten } };
    }
    return {
      block: {
        reason:
          verdict.reasons.join("; ") || "persona guard rejected the response",
      },
    };
  };
};

// Persona-guard preset (persona-guard.md §6, text/deep output gate): sugar
// that extracts the scoring rubric from the character files (SOUL/IDENTITY/
// VOICE via extractRubric) and returns an agent hook for response:before.
// Opt-in by construction: nothing builds one of these by default, and without
// an explicitly injected judgeBrain it never issues an LLM call.
export const createPersonaGuardHook = ({
  character = null,
  judgeBrain = null,
  timeout = 30000,
  failMode = "open",
  model = null,
} = {}) => {
  if (!character || typeof character !== "object") {
    throw new Error("createPersonaGuardHook requires a character profile");
  }
  const rubric = extractRubric(character);
  if (rubric.items.length === 0) {
    throw new Error(
      "createPersonaGuardHook: the character files yield no rubric items (empty SOUL/IDENTITY/VOICE)",
    );
  }
  return createAgentHook({ judgeBrain, rubric, timeout, failMode, model });
};
