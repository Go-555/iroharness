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

test("copy-on-push: mutating a reused caller buffer does not corrupt segment audio", async () => {
  const probs = [
    ...Array(3).fill(0.1),
    ...Array(10).fill(0.9),
    ...Array(10).fill(0.1)
  ];
  const vad = createSileroVad({ session: createMockSession(probs), ...PARAMS });
  const shared = new Int16Array(PARAMS.frameSamples);
  const events = [];
  for (let i = 0; i < probs.length; i += 1) {
    shared.fill(i + 1); // distinct value at push time
    events.push(...(await vad.push(shared)));
    shared.fill(-30000); // firmware-style pool reuse stomps the buffer
  }
  const end = events.find((e) => e.type === "speech.end");
  assert.ok(end);
  // retained frames are pushes 0..17 (3 pre-roll + 10 speech + 5 trailing)
  assert.equal(end.audio.length, 18 * PARAMS.frameSamples);
  for (let j = 0; j < 18; j += 1) {
    assert.equal(end.audio[j * PARAMS.frameSamples], j + 1);
  }
});

test("maxSpeechMs caps a segment and the machine can start a new one", async () => {
  // 10ms frames, maxSpeechMs 80 → cap after 8 frames of continuous speech
  const probs = Array(16).fill(0.9);
  const vad = createSileroVad({
    session: createMockSession(probs),
    ...PARAMS,
    maxSpeechMs: 80
  });
  const events = await feed(vad, probs.length);
  const starts = events.filter((e) => e.type === "speech.start");
  const ends = events.filter((e) => e.type === "speech.end");
  assert.equal(starts.length, 2);
  assert.equal(ends.length, 2);
  // each capped segment holds exactly 8 frames (no pre-roll, no trailing silence)
  assert.equal(ends[0].audio.length, 8 * PARAMS.frameSamples);
  assert.equal(ends[1].audio.length, 8 * PARAMS.frameSamples);
});

test("ort tensor plumbing: state carried across calls, fed back, and reset", async () => {
  class FakeTensor {
    constructor(type, data, dims) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  }
  const calls = [];
  const nextState = new Float32Array(256).fill(0.5);
  const session = {
    async run(feeds) {
      calls.push(feeds);
      return { output: { data: [0.1] }, stateN: { data: nextState } };
    }
  };
  const vad = createSileroVad({
    session,
    ortModule: { Tensor: FakeTensor },
    ...PARAMS
  });

  // distinctive ramp values so the context carry is observable
  const frame1 = Int16Array.from(
    { length: PARAMS.frameSamples },
    (_, i) => i + 1
  );
  await vad.push(frame1);
  // input tensor: float32 [1, 64 + frameSamples] — Silero v5 context prefix
  // (last 64 samples of the previous frame) followed by the /32768-scaled frame
  assert.equal(calls[0].input.type, "float32");
  assert.deepEqual(calls[0].input.dims, [1, 64 + PARAMS.frameSamples]);
  // first call: context prefix is all zeros
  assert.ok(calls[0].input.data.subarray(0, 64).every((v) => v === 0));
  // frame data sits after the prefix, scaled by /32768
  assert.ok(Math.abs(calls[0].input.data[64] - 1 / 32768) < 1e-6);
  // sr tensor: int64 scalar BigInt
  assert.equal(calls[0].sr.type, "int64");
  assert.equal(calls[0].sr.data[0], 16000n);
  // first call feeds a zeroed recurrent state [2,1,128] = 256 floats
  assert.deepEqual(calls[0].state.dims, [2, 1, 128]);
  assert.equal(calls[0].state.data.length, 256);
  assert.ok(calls[0].state.data.every((v) => v === 0));

  // second call: stateN fed back, context = last 64 scaled samples of frame1
  await vad.push(makeFrame(PARAMS.frameSamples));
  assert.equal(calls[1].state.data, nextState);
  for (let i = 0; i < 64; i += 1) {
    const expected = (PARAMS.frameSamples - 64 + i + 1) / 32768;
    assert.ok(Math.abs(calls[1].input.data[i] - expected) < 1e-6);
  }

  // reset() re-zeros BOTH the recurrent state and the context prefix
  vad.reset();
  await vad.push(makeFrame(PARAMS.frameSamples));
  assert.ok(calls[2].state.data.every((v) => v === 0));
  assert.ok(calls[2].input.data.subarray(0, 64).every((v) => v === 0));
});

test("push rejects frames that are not exactly frameSamples long", async () => {
  const vad = createSileroVad({ session: createMockSession([0.1]), ...PARAMS });
  await assert.rejects(() => vad.push(new Int16Array(159)), /160/);
  await assert.rejects(() => vad.push(new Int16Array(512)), /160/);
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
    // silence sanity: zeros must not look like speech
    assert.ok(probability < 0.3, `silence scored ${probability}`);
  }
);
