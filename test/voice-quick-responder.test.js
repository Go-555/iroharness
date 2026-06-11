import assert from "node:assert/strict";
import test from "node:test";
import { createQuickResponder,
  createDynamicQuickResponder, resolveQuickBrain } from "../src/voice-pipeline/quick-responder.js";

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
