// Silero VAD state machine tests (mock ort session — no model file needed).
//
// Parity fixtures against the real Python detector can be generated with the
// aiavatar venv — see fixtures/voice/README.md. The optional real-model smoke
// test below is gated by IROHARNESS_SILERO_MODEL=/path/to/silero_vad.onnx.
import assert from "node:assert/strict";
import test from "node:test";
import {
  createSileroVad,
  loadSileroSession
} from "../src/voice-pipeline/silero-vad.js";

// Small deterministic parameters: 160 samples @16k = 10ms per frame,
// minSpeechMs 30 = 3 frames, silenceMs 50 = 5 frames.
const PARAMS = {
  sampleRate: 16000,
  threshold: 0.5,
  silenceMs: 50,
  minSpeechMs: 30,
  frameSamples: 160
};

const createMockSession = (probabilities) => {
  let index = 0;
  return {
    async process() {
      const i = Math.min(index, probabilities.length - 1);
      index += 1;
      return probabilities[i];
    }
  };
};

const makeFrame = (samples, value = 1000) => new Int16Array(samples).fill(value);

const feed = async (vad, probCount) => {
  const events = [];
  for (let i = 0; i < probCount; i += 1) {
    events.push(...(await vad.push(makeFrame(PARAMS.frameSamples))));
  }
  return events;
};

test("scripted speech emits exactly one speech.start and one speech.end with pre-roll and trailing audio", async () => {
  // 3 idle frames, 10 speech frames (100ms ≥ 30ms), then silence until 50ms elapses (5 frames)
  const probs = [
    ...Array(3).fill(0.1),
    ...Array(10).fill(0.9),
    ...Array(10).fill(0.1)
  ];
  const vad = createSileroVad({ session: createMockSession(probs), ...PARAMS });
  const events = await feed(vad, probs.length);

  const starts = events.filter((e) => e.type === "speech.start");
  const ends = events.filter((e) => e.type === "speech.end");
  assert.equal(starts.length, 1);
  assert.equal(ends.length, 1);

  const audio = ends[0].audio;
  assert.ok(audio instanceof Int16Array);
  // at least the speech frames themselves
  assert.ok(audio.length >= 10 * PARAMS.frameSamples);
  // exactly pre-roll (3 idle) + speech (10) + trailing silence (5 frames = 50ms)
  assert.equal(audio.length, (3 + 10 + 5) * PARAMS.frameSamples);
});

test("pre-speech ring is capped at ~10 frames", async () => {
  // 25 idle frames — only the last 10 should survive as pre-roll
  const probs = [
    ...Array(25).fill(0.1),
    ...Array(10).fill(0.9),
    ...Array(10).fill(0.1)
  ];
  const vad = createSileroVad({ session: createMockSession(probs), ...PARAMS });
  const events = await feed(vad, probs.length);
  const end = events.find((e) => e.type === "speech.end");
  assert.ok(end);
  assert.equal(end.audio.length, (10 + 10 + 5) * PARAMS.frameSamples);
});

test("short blip below minSpeechMs emits no events ever", async () => {
  // 1 speech frame = 10ms < minSpeechMs 30 → discard silently
  const probs = [
    ...Array(3).fill(0.1),
    ...Array(1).fill(0.9),
    ...Array(20).fill(0.1)
  ];
  const vad = createSileroVad({ session: createMockSession(probs), ...PARAMS });
  const events = await feed(vad, probs.length);
  assert.deepEqual(events, []);
});

test("reset() mid-speech abandons the segment — no speech.end later", async () => {
  const probs = [
    ...Array(5).fill(0.9),
    ...Array(30).fill(0.1)
  ];
  const vad = createSileroVad({ session: createMockSession(probs), ...PARAMS });
  const before = await feed(vad, 5); // 50ms speech ≥ 30ms → speech.start emitted
  assert.equal(before.filter((e) => e.type === "speech.start").length, 1);
  vad.reset();
  const after = await feed(vad, 30);
  assert.deepEqual(after, []);
});

test("throws without a session", () => {
  assert.throws(() => createSileroVad(), /session/);
  assert.throws(() => createSileroVad({}), /session/);
});

test("loadSileroSession with failing importFn mentions onnxruntime-node", async () => {
  await assert.rejects(
    () =>
      loadSileroSession({
        modelPath: "/tmp/silero_vad.onnx",
        importFn: async () => {
          throw new Error("Cannot find module 'onnxruntime-node'");
        }
      }),
    (error) => {
      assert.match(error.message, /npm install onnxruntime-node/);
      assert.match(error.message, /snakers4\/silero-vad/);
      return true;
    }
  );
});

test(
  "real-model smoke: probability in [0,1] from silero_vad.onnx",
  { skip: !process.env.IROHARNESS_SILERO_MODEL },
  async () => {
    const session = await loadSileroSession({
      modelPath: process.env.IROHARNESS_SILERO_MODEL
    });
    const silence = new Float32Array(512);
    const probability = await session.process(silence);
    assert.equal(typeof probability, "number");
    assert.ok(probability >= 0 && probability <= 1);
  }
);
