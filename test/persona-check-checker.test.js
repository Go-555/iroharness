import assert from "node:assert/strict";
import test from "node:test";

import { checkResponses } from "../src/persona-check/checker.js";
import { parseVocabularyRules } from "../src/persona-check/rules.js";

const soul = `## Vocabulary Rules

- First person: あたし (never 私 / 僕)
- Second person: addresses the owner as 〇〇さん
- Sentence endings: plain form + よ／ね; never です・ます
- Forbidden: 拝承
`;

const rulesOf = () => parseVocabularyRules(soul).rules;

test("checkResponses flags a forbidden first-person pronoun", () => {
  const report = checkResponses({
    rules: rulesOf(),
    responses: ["私はそう思うよ。"],
  });
  assert.equal(report.ok, false);
  const violation = report.violations.find(
    (entry) => entry.rule.kind === "first-person",
  );
  assert.ok(violation);
  assert.equal(violation.matched, "私");
  assert.equal(violation.responseIndex, 0);
  assert.equal(violation.response, "私はそう思うよ。");
});

test("checkResponses flags forbidden sentence endings only at sentence end", () => {
  const report = checkResponses({
    rules: rulesOf(),
    responses: ["これはペンです。", "ですます調の話をしたよ。"],
  });
  const endingViolations = report.violations.filter(
    (entry) => entry.rule.kind === "sentence-ending",
  );
  assert.equal(endingViolations.length, 1);
  assert.equal(endingViolations[0].responseIndex, 0);
  assert.equal(endingViolations[0].matched, "です");
});

test("checkResponses flags banned vocabulary anywhere", () => {
  const report = checkResponses({
    rules: rulesOf(),
    responses: ["拝承、そのように進めるね。"],
  });
  const violation = report.violations.find(
    (entry) => entry.rule.kind === "forbidden",
  );
  assert.ok(violation);
  assert.equal(violation.matched, "拝承");
});

test("checkResponses reports one violation per rule term per response", () => {
  const report = checkResponses({
    rules: rulesOf(),
    responses: ["私と僕、どっちでもないよ。", "私だよ。"],
  });
  const firstPerson = report.violations.filter(
    (entry) => entry.rule.kind === "first-person",
  );
  assert.equal(firstPerson.length, 3); // 私+僕 in #0, 私 in #1
});

test("checkResponses passes clean in-character responses", () => {
  const report = checkResponses({
    rules: rulesOf(),
    responses: ["あたしはそう思うよ。", "うーん、わかんないなあ。"],
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.violations, []);
  assert.equal(report.responseCount, 2);
  assert.equal(report.totalRules, 4);
  assert.equal(report.checkableRules, 3);
});

test("checkResponses with zero rules is ok and reports zero checkable rules", () => {
  const report = checkResponses({ rules: [], responses: ["なんでもいいよ。"] });
  assert.equal(report.ok, true);
  assert.equal(report.checkableRules, 0);
  assert.equal(report.totalRules, 0);
});

test("checkResponses accepts response objects with a text field", () => {
  const report = checkResponses({
    rules: rulesOf(),
    responses: [{ text: "私が答えるよ。", question: "who are you" }],
  });
  assert.equal(report.ok, false);
  assert.equal(report.violations[0].response, "私が答えるよ。");
});

test("checkResponses escapes regex metacharacters in rule terms", () => {
  const { rules } = parseVocabularyRules(`## Vocabulary Rules

- Forbidden: a+b
`);
  const report = checkResponses({
    rules,
    responses: ["aab has no literal match", "use a+b here"],
  });
  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0].responseIndex, 1);
});
