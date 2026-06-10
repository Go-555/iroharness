import assert from "node:assert/strict";
import test from "node:test";
import { createQuickResponder } from "../src/voice-pipeline/quick-responder.js";

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
