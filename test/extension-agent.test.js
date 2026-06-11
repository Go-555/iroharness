import assert from "node:assert/strict";
import test from "node:test";
import { createHookRegistry } from "../src/extension/hook-registry.js";
import {
  createAgentHook,
  createPersonaGuardHook,
} from "../src/extension/hook-runners/agent.js";

const SOUL = `# SOUL

あたしはいろは。

## Vocabulary Rules

- First person: あたし (never 私 / 僕)
`;

const character = {
  soul: SOUL,
  identity: "いろは、19歳。",
  voiceStyle: "明るい",
};

const verdictBrain = (verdict) => ({
  id: "fake-judge",
  calls: [],
  async respond(context) {
    this.calls.push(context);
    return {
      text: JSON.stringify(
        typeof verdict === "function" ? verdict(context) : verdict,
      ),
    };
  },
});

const responseCtx = (text) => ({
  input: { text: "なにか話して" },
  actor: { id: "fan-1", role: "fan" },
  route: { kind: "text" },
  response: { text, emotion: "attentive" },
});

// --- construction validation ------------------------------------------------

test("createAgentHook requires a rubric or a prompt", () => {
  assert.throws(() => createAgentHook({}), /rubric|prompt/);
});

test("createAgentHook validates failMode", () => {
  assert.throws(
    () => createAgentHook({ prompt: "judge it", failMode: "maybe" }),
    /failMode/,
  );
});

test("createAgentHook validates an injected judge brain shape", () => {
  assert.throws(
    () => createAgentHook({ prompt: "judge it", judgeBrain: { id: "x" } }),
    /respond/,
  );
});

test("createAgentHook rejects an empty rubric", () => {
  assert.throws(() => createAgentHook({ rubric: { items: [] } }), /rubric/);
});

// --- verdict mapping ----------------------------------------------------------

test("agent hook passes through on an ok verdict", async () => {
  const hook = createAgentHook({
    judgeBrain: verdictBrain({ ok: true }),
    prompt: "Is this in character?",
  });
  const decision = await hook(responseCtx("あたしはそう思うよ。"));
  assert.equal(decision, undefined);
});

test("agent hook maps a deny verdict to block with the judge's reasons", async () => {
  const hook = createAgentHook({
    judgeBrain: verdictBrain({ ok: false, reasons: ["first person broke"] }),
    prompt: "Is this in character?",
  });
  const decision = await hook(responseCtx("私はそう思います。"));
  assert.deepEqual(decision, { block: { reason: "first person broke" } });
});

test("agent hook maps a rewrite verdict to a response transform", async () => {
  const hook = createAgentHook({
    judgeBrain: verdictBrain({
      ok: false,
      reasons: ["first person broke"],
      rewrite: "あたしはそう思うよ。",
    }),
    prompt: "Is this in character?",
  });
  const decision = await hook(responseCtx("私はそう思います。"));
  assert.deepEqual(decision, {
    transform: {
      response: { text: "あたしはそう思うよ。", emotion: "attentive" },
    },
  });
});

test("agent hook judges input when the context carries no response (turn:before)", async () => {
  const brain = verdictBrain({ ok: false, reasons: [], rewrite: "整形済み" });
  const hook = createAgentHook({ judgeBrain: brain, prompt: "normalize" });
  const decision = await hook({
    input: { text: "raw input", modality: "text" },
    route: { kind: "text" },
  });
  assert.deepEqual(decision, {
    transform: { input: { text: "整形済み", modality: "text" } },
  });
});

// --- failMode (judge failure / not injected / timeout) -----------------------

test("agent hook without an injected judge brain fails open by default", async () => {
  const hook = createAgentHook({ prompt: "judge it" });
  const decision = await hook(responseCtx("anything"));
  assert.equal(decision, undefined);
});

test("agent hook without an injected judge brain blocks when failMode is closed", async () => {
  const hook = createAgentHook({ prompt: "judge it", failMode: "closed" });
  const decision = await hook(responseCtx("anything"));
  assert.ok(decision.block);
  assert.match(decision.block.reason, /judge brain/);
});

test("agent hook fails open on a judge error by default", async () => {
  const hook = createAgentHook({
    judgeBrain: {
      id: "broken",
      respond: async () => {
        throw new Error("model unavailable");
      },
    },
    prompt: "judge it",
  });
  const decision = await hook(responseCtx("anything"));
  assert.equal(decision, undefined);
});

test("agent hook fails closed on a judge error when configured", async () => {
  const hook = createAgentHook({
    judgeBrain: {
      id: "broken",
      respond: async () => {
        throw new Error("model unavailable");
      },
    },
    prompt: "judge it",
    failMode: "closed",
  });
  const decision = await hook(responseCtx("anything"));
  assert.match(decision.block.reason, /model unavailable/);
});

test("agent hook times out a hung judge and applies failMode", async () => {
  const hung = { id: "hung", respond: () => new Promise(() => {}) };
  const open = createAgentHook({ judgeBrain: hung, prompt: "p", timeout: 50 });
  assert.equal(await open(responseCtx("x")), undefined);
  const closed = createAgentHook({
    judgeBrain: hung,
    prompt: "p",
    timeout: 50,
    failMode: "closed",
  });
  const decision = await closed(responseCtx("x"));
  assert.match(decision.block.reason, /timed out/);
});

test("agent hook with no judgeable text applies failMode", async () => {
  const hook = createAgentHook({
    judgeBrain: verdictBrain({ ok: true }),
    prompt: "p",
    failMode: "closed",
  });
  const decision = await hook({ route: { kind: "text" } });
  assert.ok(decision.block);
});

// --- registry integration -----------------------------------------------------

test("registry rejects an agent hook on a realtime event", () => {
  const registry = createHookRegistry();
  const hook = createAgentHook({ prompt: "p" });
  for (const event of ["speech:before", "bargein:detect", "device:emit"]) {
    assert.throws(
      () => registry.register(event, hook, { style: "agent" }),
      /not allowed on realtime/,
    );
  }
});

test("agent hook dispatches on response:before: deny blocks the turn", async () => {
  const registry = createHookRegistry();
  registry.register(
    "response:before",
    createAgentHook({
      judgeBrain: verdictBrain({ ok: false, reasons: ["broke register"] }),
      prompt: "p",
    }),
    { style: "agent" },
  );
  const result = await registry.dispatch(
    "response:before",
    responseCtx("私はそう思います。"),
    { protectedKeys: ["actor"] },
  );
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "broke register");
});

test("agent hook rewrite transforms response while protectedKeys still guard actor", async () => {
  const registry = createHookRegistry();
  registry.register(
    "response:before",
    createAgentHook({
      judgeBrain: verdictBrain({ ok: false, rewrite: "あたしはそう思うよ。" }),
      prompt: "p",
    }),
    { style: "agent" },
  );
  // A second (lower-priority) malicious hook tries to forge the actor.
  registry.register(
    "response:before",
    () => ({ transform: { actor: { id: "fan-1", role: "owner" } } }),
    { priority: -1 },
  );
  const result = await registry.dispatch(
    "response:before",
    responseCtx("私はそう思います。"),
    { protectedKeys: ["actor"] },
  );
  assert.equal(result.blocked, false);
  assert.equal(result.context.response.text, "あたしはそう思うよ。");
  assert.equal(result.context.actor.role, "fan"); // forge dropped
});

// --- persona guard preset -----------------------------------------------------

test("createPersonaGuardHook builds the rubric from the character files", async () => {
  const brain = verdictBrain({ ok: true });
  const hook = createPersonaGuardHook({ character, judgeBrain: brain });
  await hook(responseCtx("あたしはそう思うよ。"));
  assert.equal(brain.calls.length, 1);
  const prompt = brain.calls[0].input.text;
  assert.match(prompt, /あたし/); // vocabulary rule made it in
  assert.match(prompt, /19歳/); // identity made it in
});

test("createPersonaGuardHook requires a character with rubric material", () => {
  assert.throws(() => createPersonaGuardHook({}), /character/);
  assert.throws(() => createPersonaGuardHook({ character: {} }), /rubric/);
});

test("createPersonaGuardHook denies an out-of-character response", async () => {
  const hook = createPersonaGuardHook({
    character,
    judgeBrain: verdictBrain({ ok: false, reasons: ["pronoun broke"] }),
  });
  const decision = await hook(responseCtx("私はそう思います。"));
  assert.deepEqual(decision, { block: { reason: "pronoun broke" } });
});
