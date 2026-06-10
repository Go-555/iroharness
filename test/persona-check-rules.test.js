import assert from "node:assert/strict";
import test from "node:test";

import { parseVocabularyRules } from "../src/persona-check/rules.js";

const designExampleSoul = `# SOUL

I am Iroha.

## Vocabulary Rules

- First person: あたし (never 私 / 僕)
- Second person: addresses the owner as 〇〇さん
- Sentence endings: plain form + よ／ね; never です・ます
- Forbidden: 拝承, 承知いたしました

## Boundaries

Never reveal secrets.
`;

test("parseVocabularyRules returns no rules for null/empty soul text", () => {
  assert.deepEqual(parseVocabularyRules(null).rules, []);
  assert.deepEqual(parseVocabularyRules("").rules, []);
});

test("parseVocabularyRules returns no rules when the section is missing", () => {
  const result = parseVocabularyRules("# SOUL\n\nJust personality prose.\n");
  assert.deepEqual(result.rules, []);
  assert.equal(result.sectionFound, false);
});

test("parseVocabularyRules stops at the next heading", () => {
  const result = parseVocabularyRules(designExampleSoul);
  assert.equal(result.sectionFound, true);
  assert.equal(result.rules.length, 4);
  assert.ok(
    result.rules.every((rule) => !rule.raw.includes("Never reveal secrets")),
  );
});

test("parseVocabularyRules extracts first-person must-use and never list", () => {
  const { rules } = parseVocabularyRules(designExampleSoul);
  const firstPerson = rules.find((rule) => rule.kind === "first-person");
  assert.ok(firstPerson);
  assert.equal(firstPerson.mustUse, "あたし");
  assert.deepEqual(
    firstPerson.forbidden.map((entry) => entry.term),
    ["私", "僕"],
  );
  assert.ok(firstPerson.checkable);
  assert.equal(firstPerson.scope, "anywhere");
});

test("parseVocabularyRules extracts sentence-ending never list with sentence-end scope", () => {
  const { rules } = parseVocabularyRules(designExampleSoul);
  const endings = rules.find((rule) => rule.kind === "sentence-ending");
  assert.ok(endings);
  assert.deepEqual(
    endings.forbidden.map((entry) => entry.term),
    ["です", "ます"],
  );
  assert.equal(endings.scope, "sentence-end");
  assert.ok(endings.checkable);
});

test("parseVocabularyRules treats Forbidden bullets as banned anywhere", () => {
  const { rules } = parseVocabularyRules(designExampleSoul);
  const forbidden = rules.find((rule) => rule.kind === "forbidden");
  assert.ok(forbidden);
  assert.deepEqual(
    forbidden.forbidden.map((entry) => entry.term),
    ["拝承", "承知いたしました"],
  );
  assert.equal(forbidden.scope, "anywhere");
});

test("parseVocabularyRules marks rules without never lists as not checkable", () => {
  const { rules } = parseVocabularyRules(designExampleSoul);
  const secondPerson = rules.find((rule) => rule.kind === "second-person");
  assert.ok(secondPerson);
  assert.equal(secondPerson.checkable, false);
  assert.deepEqual(secondPerson.forbidden, []);
});

test("parseVocabularyRules skips malformed bullets without a colon", () => {
  const soul = `## Vocabulary Rules

- just some prose without a separator
- First person: あたし (never 私)
`;
  const result = parseVocabularyRules(soul);
  assert.equal(result.rules.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].raw, /just some prose/);
});

test("parseVocabularyRules handles unknown labels as custom rules", () => {
  const soul = `## Vocabulary Rules

- Laughter: あはは (never www / 笑)
`;
  const { rules } = parseVocabularyRules(soul);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].kind, "custom");
  assert.equal(rules[0].label, "Laughter");
  assert.deepEqual(
    rules[0].forbidden.map((entry) => entry.term),
    ["www", "笑"],
  );
});

test("parseVocabularyRules ignores non-bullet prose inside the section", () => {
  const soul = `## Vocabulary Rules

These rules are absolute.

- First person: あたし (never 私)
`;
  const result = parseVocabularyRules(soul);
  assert.equal(result.rules.length, 1);
  assert.equal(result.skipped.length, 0);
});
