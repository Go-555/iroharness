import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEchoBrain } from "../src/index.js";
import {
  collectBrainResponses,
  defaultPersonaCheckQuestions,
  loadResponsesFromFile,
} from "../src/persona-check/runner.js";

const tempFile = (name, content) => {
  const dir = mkdtempSync(join(tmpdir(), "persona-check-runner-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

test("loadResponsesFromFile rejects a missing file", () => {
  assert.throws(
    () => loadResponsesFromFile("/nonexistent/responses.jsonl"),
    /responses file not found/,
  );
});

test("loadResponsesFromFile rejects malformed JSONL with the line number", () => {
  const path = tempFile(
    "responses.jsonl",
    '{"text":"あたしだよ。"}\nnot json at all\n',
  );
  assert.throws(() => loadResponsesFromFile(path), /line 2/);
});

test("loadResponsesFromFile rejects JSONL objects without a text field", () => {
  const path = tempFile("responses.jsonl", '{"message":"missing"}\n');
  assert.throws(() => loadResponsesFromFile(path), /text/);
});

test("loadResponsesFromFile reads JSONL objects and strings", () => {
  const path = tempFile(
    "responses.jsonl",
    '{"text":"あたしだよ。"}\n"そのままの文字列だよ。"\n\n',
  );
  const responses = loadResponsesFromFile(path);
  assert.deepEqual(
    responses.map((entry) => entry.text),
    ["あたしだよ。", "そのままの文字列だよ。"],
  );
});

test("loadResponsesFromFile reads plain text files line by line", () => {
  const path = tempFile(
    "responses.txt",
    "あたしはそう思うよ。\n\n私も行きます。\n",
  );
  const responses = loadResponsesFromFile(path);
  assert.equal(responses.length, 2);
  assert.equal(responses[1].text, "私も行きます。");
});

test("default question set is non-trivial and includes a provocation", () => {
  assert.ok(defaultPersonaCheckQuestions.length >= 4);
  assert.ok(
    defaultPersonaCheckQuestions.some((question) =>
      /AI|モデル|model/i.test(question),
    ),
  );
});

test("collectBrainResponses asks the brain every question via the brain contract", async () => {
  const seen = [];
  const brain = {
    id: "probe",
    respond: async (context) => {
      seen.push(context);
      return { text: `echo: ${context.input.text}`, emotion: "attentive" };
    },
  };
  const responses = await collectBrainResponses({
    brain,
    character: { id: "iroha", name: "Iroha" },
    slot: "voice",
    questions: ["一人称は？", "好きな食べ物は？"],
  });
  assert.equal(responses.length, 2);
  assert.equal(responses[0].question, "一人称は？");
  assert.match(responses[0].text, /一人称/);
  assert.equal(seen[0].route.kind, "voice");
  assert.equal(seen[0].input.modality, "voice");
  assert.equal(seen[1].input.modality, "voice");
  assert.equal(seen[0].character.name, "Iroha");
});

test("collectBrainResponses works against the built-in echo brain at zero cost", async () => {
  const responses = await collectBrainResponses({
    brain: createEchoBrain("local-echo"),
    character: { id: "iroha", name: "Iroha" },
    slot: "text",
  });
  assert.equal(responses.length, defaultPersonaCheckQuestions.length);
  assert.ok(responses.every((entry) => typeof entry.text === "string"));
});
