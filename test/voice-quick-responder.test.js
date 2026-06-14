import assert from "node:assert/strict";
import test from "node:test";
import { createQuickResponder,
  createDynamicQuickResponder,
  createMemoryQuickResponderContextManager,
  DEFAULT_QUICK_PROMPT_PREFIX,
  DEFAULT_QUICK_REQUEST_PREFIX,
  createQuickResponderPro,
  resolveQuickBrain } from "../src/voice-pipeline/quick-responder.js";

// ---------------------------------------------------------------------------
// Mock TTS factory
// ---------------------------------------------------------------------------
const makeMockTts = ({ failPhrase = null } = {}) => {
  let streamCallCount = 0;
  const calledWith = [];

  const tts = {
    get streamCallCount() {
      return streamCallCount;
    },
    calledWith,
    async stream({ text, onEvent }) {
      streamCallCount++;
      calledWith.push(text);

      if (failPhrase !== null && text === failPhrase) {
        throw new Error(`Simulated TTS failure for: ${text}`);
      }

      // Emit one tts.audio event then tts.completed
      onEvent({
        type: "tts.audio",
        text,
        audio: Buffer.from(`audio-for-${text}`).toString("base64"),
        encoding: "wav",
        final: false,
      });
      onEvent({
        type: "tts.completed",
        text,
        audio: "",
        final: true,
      });
    },
  };

  return tts;
};

const makeNoAudioTts = () => {
  const tts = {
    async stream({ text, onEvent }) {
      // Only emits tts.completed, no tts.audio
      onEvent({ type: "tts.completed", text, audio: "", final: true });
    },
  };
  return tts;
};

// ---------------------------------------------------------------------------
// 1. fire() before warmup → null
// ---------------------------------------------------------------------------
test("fire() before warmup returns null", () => {
  const tts = makeMockTts();
  const qr = createQuickResponder({ tts, phrases: ["うん。"] });

  assert.equal(qr.fire(), null);
});

// ---------------------------------------------------------------------------
// 2. warmup resolves to cached count; fire() round-robins through phrases
// ---------------------------------------------------------------------------
test("warmup with 2 phrases resolves to 2; fire() round-robins", async () => {
  const tts = makeMockTts();
  const phrases = ["うん。", "はい。"];
  const qr = createQuickResponder({ tts, phrases });

  const count = await qr.warmup();
  assert.equal(count, 2);

  // First fire → phrase 1
  const e1 = qr.fire();
  assert.ok(e1, "first fire should return an entry");
  assert.equal(e1.text, "うん。");
  assert.equal(e1.audio, Buffer.from("audio-for-うん。").toString("base64"));
  assert.equal(e1.encoding, "wav");

  // Second fire → phrase 2
  const e2 = qr.fire();
  assert.ok(e2, "second fire should return an entry");
  assert.equal(e2.text, "はい。");

  // Third fire → wraps around to phrase 1
  const e3 = qr.fire();
  assert.ok(e3, "third fire should wrap around");
  assert.equal(e3.text, "うん。");
});

// ---------------------------------------------------------------------------
// 3. one phrase's stream throws → warmup resolves 1, not rejects; fire()
//    only returns the good phrase
// ---------------------------------------------------------------------------
test("failed phrase is skipped; warmup resolves 1, fire returns good phrase", async () => {
  const tts = makeMockTts({ failPhrase: "失敗。" });
  const phrases = ["良い。", "失敗。"];
  const qr = createQuickResponder({ tts, phrases });

  const count = await qr.warmup();
  assert.equal(count, 1);

  const e1 = qr.fire();
  assert.ok(e1);
  assert.equal(e1.text, "良い。");

  // Multiple fires always return the one good phrase
  const e2 = qr.fire();
  assert.equal(e2.text, "良い。");
});

// ---------------------------------------------------------------------------
// 4. phrase yielding no tts.audio event → not cached
// ---------------------------------------------------------------------------
test("phrase with no tts.audio event is not cached", async () => {
  const tts = makeNoAudioTts();
  const qr = createQuickResponder({ tts, phrases: ["無音。"] });

  const count = await qr.warmup();
  assert.equal(count, 0);
  assert.equal(qr.fire(), null);
});

// ---------------------------------------------------------------------------
// 5. second warmup() does not re-synthesize already-cached phrases
// ---------------------------------------------------------------------------
test("second warmup() is idempotent — does not re-call tts.stream for cached phrases", async () => {
  const tts = makeMockTts();
  const qr = createQuickResponder({ tts, phrases: ["うん。", "はい。"] });

  await qr.warmup();
  const callsAfterFirst = tts.streamCallCount;
  assert.equal(callsAfterFirst, 2);

  await qr.warmup();
  // No new calls — already cached
  assert.equal(tts.streamCallCount, 2, "tts.stream should not be called again on second warmup");
});

// ---------------------------------------------------------------------------
// 6. constructor throws without tts
// ---------------------------------------------------------------------------
test("constructor throws when tts is missing", () => {
  assert.throws(
    () => createQuickResponder({ phrases: ["うん。"] }),
    /tts/i,
  );
});

test("constructor throws when tts.stream is not a function", () => {
  assert.throws(
    () => createQuickResponder({ tts: { stream: "not-a-function" } }),
    /tts/i,
  );
});

// ===========================================================================
// createDynamicQuickResponder
// ===========================================================================

// Mock brain factory: respondStream yields scripted deltas. Tracks contexts
// and how many deltas were actually pulled (for early-stop assertions).
const makeMockBrain = ({ deltas = ["お、天気か。"], neverYields = false, throws = false } = {}) => {
  const contexts = [];
  let pulled = 0;
  return {
    contexts,
    get pulled() {
      return pulled;
    },
    async *respondStream(context) {
      contexts.push(context);
      if (throws) {
        throw new Error("brain boom");
      }
      if (neverYields) {
        await new Promise(() => {}); // hangs forever — only the timeout saves us
      }
      for (const delta of deltas) {
        pulled += 1;
        yield { delta };
      }
    },
  };
};

const makeWarmedFallback = async (phrase = "うん。") => {
  const fallback = createQuickResponder({ tts: makeMockTts(), phrases: [phrase] });
  await fallback.warmup();
  return fallback;
};

test("dynamic: fast brain → dynamic text synthesized via tts, dynamic: true", async () => {
  const brain = makeMockBrain({ deltas: ["お、", "天気か。"] });
  const tts = makeMockTts();
  const qr = createDynamicQuickResponder({ brain, tts });

  const result = await qr.fireFor("今日の天気どう？");
  assert.ok(result, "fireFor should return a result");
  assert.equal(result.text, "お、天気か。");
  assert.equal(result.audio, Buffer.from("audio-for-お、天気か。").toString("base64"));
  assert.equal(result.encoding, "wav");
  assert.equal(result.dynamic, true);

  // The brain receives the JA quick prompt prefix + blank line + transcript.
  assert.equal(brain.contexts.length, 1);
  const sent = brain.contexts[0]?.input?.text ?? "";
  assert.ok(sent.endsWith("\n\n今日の天気どう？"), "transcript appended after blank line");
  assert.ok(sent.includes("10文字以内"), "JA quick prompt prefix present");
});

test("dynamic: maxChars caps the text and stops pulling deltas early", async () => {
  const deltas = Array.from({ length: 50 }, () => "ながいながい話。");
  const brain = makeMockBrain({ deltas });
  const tts = makeMockTts();
  const qr = createDynamicQuickResponder({ brain, tts, maxChars: 10 });

  const result = await qr.fireFor("長話して");
  assert.ok(result);
  assert.equal(result.dynamic, true);
  assert.ok(result.text.length <= 10, `text within budget (got ${result.text.length})`);
  assert.ok(brain.pulled < deltas.length, `iteration stopped early (pulled ${brain.pulled})`);
});

test("dynamic: slow brain times out → static fallback result (no dynamic flag)", async () => {
  const brain = makeMockBrain({ neverYields: true });
  const fallback = await makeWarmedFallback("うん。");
  const qr = createDynamicQuickResponder({ brain, tts: makeMockTts(), fallback, timeoutMs: 30 });

  const result = await qr.fireFor("もしもし");
  assert.ok(result, "fallback result expected");
  assert.equal(result.text, "うん。");
  assert.equal(result.dynamic, undefined, "static fallback has no dynamic flag");
});

test("dynamic: brain throws → fallback", async () => {
  const brain = makeMockBrain({ throws: true });
  const fallback = await makeWarmedFallback("はい。");
  const qr = createDynamicQuickResponder({ brain, tts: makeMockTts(), fallback });

  const result = await qr.fireFor("もしもし");
  assert.equal(result.text, "はい。");
  assert.equal(result.dynamic, undefined);
});

test("dynamic: empty/whitespace deltas → fallback", async () => {
  const brain = makeMockBrain({ deltas: ["", "  ", "\n"] });
  const fallback = await makeWarmedFallback("ええ。");
  const qr = createDynamicQuickResponder({ brain, tts: makeMockTts(), fallback });

  const result = await qr.fireFor("もしもし");
  assert.equal(result.text, "ええ。");
});

test("dynamic: failure with no fallback → null", async () => {
  const brain = makeMockBrain({ throws: true });
  const qr = createDynamicQuickResponder({ brain, tts: makeMockTts() });

  assert.equal(await qr.fireFor("もしもし"), null);
});

test("dynamic: tts emitting no audio → fallback", async () => {
  const brain = makeMockBrain();
  const fallback = await makeWarmedFallback("おう。");
  const qr = createDynamicQuickResponder({ brain, tts: makeNoAudioTts(), fallback });

  const result = await qr.fireFor("もしもし");
  assert.equal(result.text, "おう。");
});

test("dynamic: pre-aborted signal → fallback, brain text discarded", async () => {
  const brain = makeMockBrain();
  const fallback = await makeWarmedFallback("ん。");
  const qr = createDynamicQuickResponder({ brain, tts: makeMockTts(), fallback });

  const controller = new AbortController();
  controller.abort();
  const result = await qr.fireFor("もしもし", { signal: controller.signal });
  assert.equal(result.text, "ん。");
  assert.equal(result.dynamic, undefined);
});

test("dynamic: warmup() delegates to fallback.warmup()", async () => {
  const brain = makeMockBrain();
  let warmupCalls = 0;
  const fallback = {
    warmup: async () => {
      warmupCalls += 1;
      return 3;
    },
    fire: () => null,
  };
  const qr = createDynamicQuickResponder({ brain, tts: makeMockTts(), fallback });

  assert.equal(await qr.warmup(), 3);
  assert.equal(warmupCalls, 1);
});

test("dynamic: warmup() without fallback resolves 0", async () => {
  const qr = createDynamicQuickResponder({ brain: makeMockBrain(), tts: makeMockTts() });
  assert.equal(await qr.warmup(), 0);
});

test("dynamic: constructor validates brain and tts", () => {
  assert.throws(() => createDynamicQuickResponder({ tts: makeMockTts() }), /brain/i);
  assert.throws(() => createDynamicQuickResponder({ brain: {}, tts: makeMockTts() }), /brain/i);
  assert.throws(() => createDynamicQuickResponder({ brain: makeMockBrain() }), /tts/i);
});

test("resolveQuickBrain prefers the dedicated quick brain even over a codex voice brain", () => {
  const quickBrain = { id: "quick" };
  const voiceBrain = { id: "voice-codex" };
  const resolved = resolveQuickBrain({ quickBrain, voiceBrain, voiceBrainIsCodex: true });
  assert.equal(resolved.brain, quickBrain);
  assert.equal(resolved.downgraded, false);
});

test("resolveQuickBrain falls back to a non-codex voice brain", () => {
  const voiceBrain = { id: "voice-openai" };
  const resolved = resolveQuickBrain({ voiceBrain, voiceBrainIsCodex: false });
  assert.equal(resolved.brain, voiceBrain);
  assert.equal(resolved.downgraded, false);
});

test("resolveQuickBrain refuses a codex voice brain fallback (downgraded)", () => {
  const resolved = resolveQuickBrain({ voiceBrain: { id: "voice-codex" }, voiceBrainIsCodex: true });
  assert.equal(resolved.brain, null);
  assert.equal(resolved.downgraded, true);
});

// ===========================================================================
// createQuickResponderPro
// ===========================================================================

const makeFetch = ({ text = "なるほど。", delayMs = 0, status = 200 } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return "bad";
      },
      async json() {
        return {
          choices: [
            {
              message: {
                content: text
              }
            }
          ]
        };
      }
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
};

test("pro: direct chat completion generates contextual ack and synthesizes it", async () => {
  const tts = makeMockTts();
  const fetchImpl = makeFetch({ text: "それは大変。" });
  const qr = createQuickResponderPro({
    tts,
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "gpt-4.1-nano",
    fetchImpl
  });

  const result = await qr.fireFor("今日ちょっと疲れた");

  assert.equal(result.text, "それは大変。");
  assert.equal(result.audio, Buffer.from("audio-for-それは大変。").toString("base64"));
  assert.equal(result.encoding, "wav");
  assert.equal(result.pro, true);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, "https://example.test/v1/chat/completions");
  assert.equal(fetchImpl.calls[0].body.model, "gpt-4.1-nano");
  assert.equal(fetchImpl.calls[0].body.stream, false);
  assert.ok(fetchImpl.calls[0].body.messages[0].content.includes("10文字以内"));
  assert.ok(fetchImpl.calls[0].body.messages[1].content.endsWith("\n\n今日ちょっと疲れた"));
});

test("pro: voice cache avoids repeating TTS for the same generated phrase", async () => {
  const tts = makeMockTts();
  const fetchImpl = makeFetch({ text: "いいね。" });
  const qr = createQuickResponderPro({ tts, apiKey: "test-key", fetchImpl });

  await qr.fireFor("一回目");
  await qr.fireFor("二回目");

  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(tts.streamCallCount, 1);
});

test("pro: timeout falls back to static quick responder", async () => {
  const fallback = await makeWarmedFallback("うん。");
  const qr = createQuickResponderPro({
    tts: makeMockTts(),
    apiKey: "test-key",
    fetchImpl: makeFetch({ delayMs: 50 }),
    fallback,
    timeoutMs: 10
  });

  const result = await qr.fireFor("もしもし");

  assert.equal(result.text, "うん。");
  assert.equal(result.pro, undefined);
});

test("pro: cleaned context history is included in the direct chat completion", async () => {
  const contextManager = createMemoryQuickResponderContextManager();
  await contextManager.addHistories("ctx-1", [
    { role: "assistant", content: "orphaned assistant message" },
    { role: "user", content: `${DEFAULT_QUICK_PROMPT_PREFIX}\n\nこんにちは` },
    { role: "assistant", content: "<think>internal</think><answer>やあ。</answer>" },
    {
      role: "user",
      content: `${DEFAULT_QUICK_REQUEST_PREFIX.replaceAll("{quick_response_text}", "やあ。")}\n\nこんにちは`
    },
    {
      role: "assistant",
      content: "<think>internal</think><answer>元気だよ。[face:joy]<face name=\"joy\" /></answer>"
    }
  ]);
  const fetchImpl = makeFetch({ text: "なるほど。" });
  const qr = createQuickResponderPro({
    tts: makeMockTts(),
    apiKey: "test-key",
    fetchImpl,
    contextManager,
    contextId: "ctx-1"
  });

  await qr.fireFor("今日の予定どう？");

  const messages = fetchImpl.calls[0].body.messages;
  assert.equal(messages[1].role, "user");
  assert.ok(messages[1].content.startsWith(DEFAULT_QUICK_PROMPT_PREFIX));
  assert.deepEqual(messages.slice(2, 5), [
    { role: "assistant", content: "やあ。" },
    { role: "user", content: "「やあ。」の続きを出力してください" },
    { role: "assistant", content: "元気だよ。" }
  ]);
  assert.equal(messages.at(-1).content, `${DEFAULT_QUICK_PROMPT_PREFIX}\n\n今日の予定どう？`);
  assert.equal(
    messages.some((message) => String(message.content).includes("orphaned assistant message")),
    false
  );
});

test("pro: saves quick and main response history for the next quick turn", async () => {
  const contextManager = createMemoryQuickResponderContextManager();
  const fetchImpl = makeFetch({ text: "それは大変。" });
  const qr = createQuickResponderPro({
    tts: makeMockTts(),
    apiKey: "test-key",
    fetchImpl,
    contextManager,
    contextId: "ctx-2"
  });

  await qr.fireFor("今日は疲れた");
  await qr.saveMainResponse({
    transcript: "今日は疲れた",
    quickText: "それは大変。",
    responseText: "今日は早めに休もう。"
  });
  await qr.fireFor("明日は忙しい？");

  const messages = fetchImpl.calls[1].body.messages;
  assert.ok(
    messages.some(
      (message) =>
        message.role === "user" &&
        message.content === `${DEFAULT_QUICK_PROMPT_PREFIX}\n\n今日は疲れた`
    )
  );
  assert.ok(messages.some((message) => message.role === "assistant" && message.content === "それは大変。"));
  assert.ok(
    messages.some(
      (message) =>
        message.role === "user" &&
        message.content === "「それは大変。」の続きを出力してください"
    )
  );
  assert.ok(
    messages.some((message) => message.role === "assistant" && message.content === "今日は早めに休もう。")
  );
});

test("pro: constructor validates required dependencies", () => {
  assert.throws(() => createQuickResponderPro({ tts: makeMockTts() }), /apiKey/i);
  assert.throws(() => createQuickResponderPro({ apiKey: "x" }), /tts/i);
  assert.throws(
    () => createQuickResponderPro({ tts: makeMockTts(), apiKey: "x", fetchImpl: null }),
    /fetchImpl/i
  );
});
