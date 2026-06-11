import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runPersonaCheck } from "../src/persona-check/index.js";

const SOUL = `# SOUL

あたしはいろは。

## Vocabulary Rules

- First person: あたし (never 私 / 僕)
- Forbidden: 拝承
`;

const companionDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "persona-rich-"));
  writeFileSync(join(dir, "SOUL.md"), SOUL);
  writeFileSync(join(dir, "IDENTITY.md"), "いろは、19歳の配信者。");
  return dir;
};

const responsesFile = (dir, lines) => {
  const path = join(dir, "responses.jsonl");
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n"));
  return path;
};

const verdictBrain = (byText) => ({
  id: "fake-judge",
  calls: [],
  async respond(context) {
    this.calls.push(context);
    const hit = Object.entries(byText).find(([needle]) =>
      context.input.text.includes(needle),
    );
    return { text: JSON.stringify(hit ? hit[1] : { ok: true, reasons: [] }) };
  },
});

test("rich tier judges every response against the character rubric", async () => {
  const dir = companionDir();
  const path = responsesFile(dir, [
    { text: "あたしはそう思うよ。" },
    { text: "私はそう思います。" },
  ]);
  const judgeBrain = verdictBrain({
    私はそう思います: { ok: false, reasons: ["first person broke"] },
  });
  const result = await runPersonaCheck({
    dir,
    responsesPath: path,
    rich: true,
    judgeBrain,
  });
  assert.equal(result.tier, "rich");
  assert.equal(judgeBrain.calls.length, 2);
  assert.equal(result.judge.results.length, 2);
  assert.equal(result.judge.results[0].ok, true);
  assert.equal(result.judge.results[1].ok, false);
  assert.deepEqual(result.judge.results[1].reasons, ["first person broke"]);
  assert.equal(result.judge.ok, false);
  // the cheap tier also fired (私 violation), and overall ok composes both
  assert.equal(result.ok, false);
  // the rubric included identity material, not just vocabulary rules
  assert.match(judgeBrain.calls[0].input.text, /配信者/);
});

test("rich tier passes when the judge approves and the cheap tier is clean", async () => {
  const dir = companionDir();
  const path = responsesFile(dir, [{ text: "あたしはそう思うよ。" }]);
  const result = await runPersonaCheck({
    dir,
    responsesPath: path,
    rich: true,
    judgeBrain: verdictBrain({}),
  });
  assert.equal(result.ok, true);
  assert.equal(result.judge.ok, true);
  assert.ok(result.judge.rubricItems >= 2);
});

test("rich tier fails the whole run when the cheap tier fails even if the judge approves", async () => {
  const dir = companionDir();
  const path = responsesFile(dir, [{ text: "拝承いたしました。" }]);
  const result = await runPersonaCheck({
    dir,
    responsesPath: path,
    rich: true,
    judgeBrain: verdictBrain({}), // judge says ok to everything
  });
  assert.equal(result.judge.ok, true);
  assert.equal(result.ok, false); // mechanical 拝承 violation still fails
});

test("rich without an injected judge brain throws (never silently bills or passes)", async () => {
  const dir = companionDir();
  const path = responsesFile(dir, [{ text: "あたしだよ。" }]);
  await assert.rejects(
    runPersonaCheck({ dir, responsesPath: path, rich: true }),
    /judge brain/i,
  );
  await assert.rejects(
    runPersonaCheck({
      dir,
      responsesPath: path,
      rich: true,
      judgeBrain: { id: "no-respond" },
    }),
    /judge brain/i,
  );
});

test("a judge failure mid-run fails loud (no silent pass)", async () => {
  const dir = companionDir();
  const path = responsesFile(dir, [{ text: "あたしだよ。" }]);
  await assert.rejects(
    runPersonaCheck({
      dir,
      responsesPath: path,
      rich: true,
      judgeBrain: {
        id: "broken",
        respond: async () => {
          throw new Error("model unavailable");
        },
      },
    }),
    /model unavailable/,
  );
});

test("cheap tier report shape is unchanged when rich is off", async () => {
  const dir = companionDir();
  const path = responsesFile(dir, [{ text: "あたしだよ。" }]);
  const result = await runPersonaCheck({ dir, responsesPath: path });
  assert.equal(result.tier, "cheap");
  assert.equal(result.judge, undefined);
});
