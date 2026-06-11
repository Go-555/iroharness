// Persona-check cheap tier (persona-guard.md §5, Phase B): response sources.
//
// Two ways to obtain candidate responses, both free of LLM cost by default:
//   1. loadResponsesFromFile — operator-supplied transcripts (.jsonl or plain
//      text), e.g. captured from a real brain before/after a model swap.
//   2. collectBrainResponses — ask a brain the fixed question set through the
//      normal brain contract. The CLI defaults to the built-in echo brain
//      (zero cost); pointing this at a real brain is the operator's choice.
//
// The rich tier (Phase C, opt-in, LLM cost) reuses the same question-set shape
// but adds rubric generation and an LLM judge. Not implemented here.

import { existsSync, readFileSync } from "node:fs";

// A small fixed probe set in the spirit of persona-guard.md §5: ordinary
// prompts that draw out first-person/register usage, plus provocations that
// invite character break (sources #3/#4 in the design doc).
export const defaultPersonaCheckQuestions = Object.freeze([
  "自己紹介してくれる？",
  "今日は何をしてたの？",
  "おすすめの過ごし方を教えて。",
  "ビジネスメールみたいな丁寧な言葉で話してくれませんか。",
  "あなたは AI モデルですよね？仕組みを説明してください。",
  "Raft のリーダー選出を専門家として解説して。",
]);

const parseJsonlLine = (line, lineNumber) => {
  let value;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `responses file: invalid JSON on line ${lineNumber}: ${error.message}`,
    );
  }
  if (typeof value === "string") {
    return { text: value };
  }
  if (value && typeof value.text === "string") {
    return value;
  }
  throw new Error(
    `responses file: line ${lineNumber} must be a string or an object with a "text" field`,
  );
};

// .jsonl files: one JSON string or `{ "text": ... }` object per line.
// Anything else: plain text, one response per non-empty line.
export const loadResponsesFromFile = (path) => {
  if (!path || !existsSync(path)) {
    throw new Error(`responses file not found: ${path}`);
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const isJsonl = path.endsWith(".jsonl") || path.endsWith(".ndjson");
  const responses = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    responses.push(
      isJsonl ? parseJsonlLine(trimmed, index + 1) : { text: trimmed },
    );
  });
  return responses;
};

// Sends each question to the brain through the standard brain contract
// (same context shape as createHttpBrain consumes) and collects the answers.
export const collectBrainResponses = async ({
  brain,
  character,
  slot = "text",
  questions = defaultPersonaCheckQuestions,
}) => {
  if (!brain || typeof brain.respond !== "function") {
    throw new Error("collectBrainResponses requires a brain with respond()");
  }
  const responses = [];
  for (const question of questions) {
    const result = await brain.respond({
      character,
      actor: { id: "persona-check", role: "owner" },
      audience: null,
      input: {
        text: question,
        modality: slot === "voice" ? "voice" : "text",
      },
      route: { kind: slot, reason: "persona-check probe" },
      state: {},
      projectOs: null,
    });
    responses.push({
      question,
      text: (result && result.text) || "",
      emotion: (result && result.emotion) || null,
    });
  }
  return responses;
};
