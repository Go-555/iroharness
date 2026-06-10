import assert from "node:assert/strict";
import test from "node:test";
import { createSentenceSplitter } from "../src/voice-pipeline/sentence-splitter.js";

test("splits on Japanese terminal punctuation", () => {
  const s = createSentenceSplitter();
  assert.deepEqual(s.push("今日は晴れ"), []);
  assert.deepEqual(s.push("だよ。明日は"), ["今日は晴れだよ。"]);
  assert.deepEqual(s.flush(), ["明日は"]);
});

test("splits long clause on comma past threshold (terminal char absent)", () => {
  // option split（、）は終端文字で切れず buffer に残った文にだけ効く（本家 llm/base.py と同じ:
  // option_split は split_chars カット後の残り buffer が threshold 超のときの fallback）
  const s = createSentenceSplitter({ optionSplitThreshold: 10 });
  assert.deepEqual(s.push("あいうえおかきくけこ、さしすせ"), [
    "あいうえおかきくけこ、",
  ]);
  assert.deepEqual(s.flush(), ["さしすせ"]);
});

test("handles mixed EN/JA and newline", () => {
  const s = createSentenceSplitter();
  assert.deepEqual(s.push("OK. Got it\nright"), ["OK. ", "Got it\n"]);
  assert.deepEqual(s.flush(), ["right"]);
});

test("empty delta and flush of empty buffer", () => {
  const s = createSentenceSplitter();
  assert.deepEqual(s.push(""), []);
  assert.deepEqual(s.flush(), []);
});
