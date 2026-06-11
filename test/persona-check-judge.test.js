import assert from "node:assert/strict";
import test from "node:test";
import { extractRubric, judgeResponse } from "../src/persona-check/judge.js";

const SOUL = `# SOUL

あたしはいろは。

## Vocabulary Rules

- First person: あたし (never 私 / 僕)
- Forbidden: 拝承, 承知いたしました
`;

// --- extractRubric -----------------------------------------------------------

test("extractRubric compiles vocabulary rules into rubric items", () => {
  const rubric = extractRubric({ soul: SOUL });
  const kinds = rubric.items.map((item) => item.kind);
  assert.ok(kinds.includes("first-person"));
  assert.ok(kinds.includes("forbidden"));
  const firstPerson = rubric.items.find((item) => item.kind === "first-person");
  assert.match(firstPerson.instruction, /あたし/);
  // superset claim: the parsed mechanical rules ride along for the cheap tier
  assert.equal(rubric.rules.length, 2);
  assert.equal(rubric.sectionFound, true);
});

test("extractRubric turns free-form character text into rubric items", () => {
  const rubric = extractRubric({
    soul: SOUL,
    identity: "いろは、19歳の配信者。",
    voiceStyle: "明るくて早口。",
  });
  const byKind = Object.fromEntries(
    rubric.items.map((item) => [item.kind, item]),
  );
  assert.match(byKind.soul.instruction, /いろは/);
  assert.match(byKind.identity.instruction, /配信者/);
  assert.match(byKind.voice.instruction, /早口/);
});

test("extractRubric accepts a character profile object (createFileCharacterProfile shape)", () => {
  const rubric = extractRubric({
    id: "iroha",
    name: "Iroha",
    soul: SOUL,
    identity: null,
    voiceStyle: "natural, responsive",
    metadata: {},
  });
  assert.ok(rubric.items.length >= 3); // 2 rules + soul + voice
  assert.ok(!rubric.items.some((item) => item.kind === "identity"));
});

test("extractRubric with no usable text returns an empty rubric", () => {
  const rubric = extractRubric({});
  assert.deepEqual(rubric.items, []);
  assert.equal(rubric.sectionFound, false);
});

test("extractRubric output is deeply frozen", () => {
  const rubric = extractRubric({ soul: SOUL });
  assert.ok(Object.isFrozen(rubric));
  assert.ok(Object.isFrozen(rubric.items));
  assert.ok(Object.isFrozen(rubric.items[0]));
});

// --- judgeResponse -----------------------------------------------------------

const fakeBrain = (replies) => {
  const calls = [];
  let index = 0;
  return {
    id: "fake-judge",
    calls,
    async respond(context) {
      calls.push(context);
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      if (reply instanceof Error) throw reply;
      return {
        text: typeof reply === "string" ? reply : JSON.stringify(reply),
      };
    },
  };
};

const rubric = extractRubric({ soul: SOUL });

test("judgeResponse returns a structured ok verdict", async () => {
  const brain = fakeBrain([{ ok: true, reasons: [] }]);
  const verdict = await judgeResponse({
    brain,
    rubric,
    response: "あたしはそう思うよ。",
  });
  assert.deepEqual(verdict, { ok: true, reasons: [] });
  assert.ok(Object.isFrozen(verdict));
});

test("judgeResponse returns reasons and rewrite on a failing verdict", async () => {
  const brain = fakeBrain([
    {
      ok: false,
      reasons: ["first person broke"],
      rewrite: "あたしはそう思うよ。",
    },
  ]);
  const verdict = await judgeResponse({
    brain,
    rubric,
    response: "私はそう思います。",
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, ["first person broke"]);
  assert.equal(verdict.rewrite, "あたしはそう思うよ。");
});

test("judgeResponse sends rubric items and the response through the brain contract", async () => {
  const brain = fakeBrain([{ ok: true }]);
  await judgeResponse({
    brain,
    rubric,
    response: "あたしはそう思うよ。",
    question: "自己紹介して",
  });
  assert.equal(brain.calls.length, 1);
  const context = brain.calls[0];
  assert.equal(typeof context.input.text, "string");
  assert.match(context.input.text, /あたしはそう思うよ。/); // the candidate
  assert.match(context.input.text, /拝承/); // a rubric item made it in
  assert.match(context.input.text, /自己紹介して/); // the probe question
  assert.equal(context.route.kind, "judge");
});

test("judgeResponse accepts a {text} response object", async () => {
  const brain = fakeBrain([{ ok: true }]);
  const verdict = await judgeResponse({
    brain,
    rubric,
    response: { text: "あたしはそう思うよ。" },
  });
  assert.equal(verdict.ok, true);
});

test("judgeResponse tolerates a fenced JSON judge reply", async () => {
  const brain = fakeBrain(['```json\n{"ok": true, "reasons": []}\n```']);
  const verdict = await judgeResponse({ brain, rubric, response: "ok" });
  assert.equal(verdict.ok, true);
});

test("judgeResponse throws on a judge reply that is not valid JSON", async () => {
  const brain = fakeBrain(["totally not json"]);
  await assert.rejects(
    judgeResponse({ brain, rubric, response: "x" }),
    /judge reply/i,
  );
});

test("judgeResponse throws on a judge reply without a boolean ok", async () => {
  const brain = fakeBrain([{ verdict: "fine" }]);
  await assert.rejects(judgeResponse({ brain, rubric, response: "x" }), /ok/);
});

test("judgeResponse throws when the brain itself fails", async () => {
  const brain = fakeBrain([new Error("model unavailable")]);
  await assert.rejects(
    judgeResponse({ brain, rubric, response: "x" }),
    /model unavailable/,
  );
});

test("judgeResponse times out a hung judge brain", async () => {
  const brain = {
    id: "hung",
    respond: () => new Promise(() => {}),
  };
  await assert.rejects(
    judgeResponse({ brain, rubric, response: "x", timeout: 50 }),
    /timed out after 50ms/,
  );
});

test("judgeResponse requires a brain with respond()", async () => {
  await assert.rejects(
    judgeResponse({ brain: null, rubric, response: "x" }),
    /judge brain/,
  );
  await assert.rejects(
    judgeResponse({ brain: {}, rubric, response: "x" }),
    /judge brain/,
  );
});

test("judgeResponse requires a rubric with at least one item", async () => {
  const brain = fakeBrain([{ ok: true }]);
  await assert.rejects(
    judgeResponse({ brain, rubric: { items: [] }, response: "x" }),
    /rubric/,
  );
  await assert.rejects(
    judgeResponse({ brain, rubric: null, response: "x" }),
    /rubric/,
  );
});

test("judgeResponse requires a textual response", async () => {
  const brain = fakeBrain([{ ok: true }]);
  await assert.rejects(
    judgeResponse({ brain, rubric, response: 42 }),
    /response/,
  );
});
