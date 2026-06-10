// Silero VAD speech detector (mirrors AIAvatarKit SileroStreamSpeechDetector semantics).
//
// createSileroVad({ session, sampleRate = 16000, threshold = 0.5, silenceMs = 650,
//                   minSpeechMs = 250, frameSamples = 512, ortModule })
//   → frozen { async push(int16Frame) → events[], reset() }
//
// session (REQUIRED) is either:
//   - duck-typed { async process(float32Frame) → probability } — no onnxruntime needed
//   - a raw onnxruntime InferenceSession ({ async run(feeds) }) — tensor plumbing is
//     done internally, lazily importing "onnxruntime-node" (or using injected ortModule)
//     only when the first frame is pushed.
//
// Time is measured on a sample-count clock (frames × samples / sampleRate), never wall
// clock — silenceMs / minSpeechMs are audio-time thresholds, matching the Python detector.
//
// Events:
//   { type: "speech.start" }                  — once, when speech crosses minSpeechMs
//   { type: "speech.end", audio: Int16Array } — pre-roll + speech + trailing silence
//
// loadSileroSession({ modelPath, ortModule, importFn, sampleRate }) → { process, reset }
//   Lazily imports onnxruntime-node and wraps an InferenceSession created from modelPath.
//   Model download: https://github.com/snakers4/silero-vad

const PRE_ROLL_FRAMES = 10;
const STATE_SIZE = 2 * 1 * 128; // Silero v5 recurrent state [2, 1, 128]

const int16ToFloat32 = (int16Frame) => {
  const out = new Float32Array(int16Frame.length);
  for (let i = 0; i < int16Frame.length; i += 1) {
    out[i] = int16Frame[i] / 32768;
  }
  return out;
};

const concatFrames = (frames) => {
  let total = 0;
  for (const frame of frames) total += frame.length;
  const out = new Int16Array(total);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.length;
  }
  return out;
};

const importOrt = async (importFn) => {
  const doImport = importFn ?? (() => import("onnxruntime-node"));
  const mod = await doImport("onnxruntime-node");
  return mod.default ?? mod;
};

// Tensor plumbing for a raw ort-style session. Keeps the Silero v5 recurrent
// state across calls; reset() clears it.
const createOrtFrameRunner = ({ session, sampleRate, ortModule, importFn }) => {
  let ortPromise = null;
  let state = new Float32Array(STATE_SIZE);

  const getOrt = () => {
    ortPromise ??= ortModule ? Promise.resolve(ortModule) : importOrt(importFn);
    return ortPromise;
  };

  const process = async (float32Frame) => {
    const ort = await getOrt();
    const feeds = {
      input: new ort.Tensor("float32", float32Frame, [1, float32Frame.length]),
      sr: new ort.Tensor("int64", BigInt64Array.from([BigInt(sampleRate)]), []),
      state: new ort.Tensor("float32", state, [2, 1, 128])
    };
    const result = await session.run(feeds);
    state = result.stateN.data;
    return result.output.data[0];
  };

  const reset = () => {
    state = new Float32Array(STATE_SIZE);
  };

  return { process, reset };
};

export const createSileroVad = ({
  session,
  sampleRate = 16000,
  threshold = 0.5,
  silenceMs = 650,
  minSpeechMs = 250,
  frameSamples = 512,
  ortModule
} = {}) => {
  if (
    !session ||
    (typeof session.process !== "function" && typeof session.run !== "function")
  ) {
    throw new Error(
      "createSileroVad requires a session with process(float32Frame) or run(feeds)"
    );
  }

  const runner =
    typeof session.process === "function"
      ? session
      : createOrtFrameRunner({ session, sampleRate, ortModule });

  const minSpeechSamples = (minSpeechMs * sampleRate) / 1000;
  const silenceSamplesLimit = (silenceMs * sampleRate) / 1000;

  // idle → tentative (prob ≥ threshold) → speech (≥ minSpeechMs) → idle (end/discard)
  let phase = "idle";
  let preRoll = []; // ring of last PRE_ROLL_FRAMES frames while idle
  let segment = []; // pre-roll + speech + trailing silence frames
  let voicedSamples = 0; // speech extent from segment start to last voiced frame
  let elapsedSamples = 0; // samples since segment start (excluding pre-roll)
  let silenceRun = 0; // consecutive sub-threshold samples
  let started = false; // speech.start emitted for current segment

  const goIdle = () => {
    phase = "idle";
    segment = [];
    preRoll = [];
    voicedSamples = 0;
    elapsedSamples = 0;
    silenceRun = 0;
    started = false;
  };

  const push = async (int16Frame) => {
    const probability = await runner.process(int16ToFloat32(int16Frame));
    const events = [];

    if (phase === "idle") {
      if (probability >= threshold) {
        phase = "tentative";
        segment = [...preRoll, int16Frame];
        preRoll = [];
        elapsedSamples = int16Frame.length;
        voicedSamples = int16Frame.length;
        silenceRun = 0;
        started = false;
      } else {
        preRoll.push(int16Frame);
        if (preRoll.length > PRE_ROLL_FRAMES) preRoll.shift();
      }
      return events;
    }

    segment.push(int16Frame);
    elapsedSamples += int16Frame.length;

    if (probability >= threshold) {
      silenceRun = 0;
      voicedSamples = elapsedSamples;
      if (!started && voicedSamples >= minSpeechSamples) {
        started = true;
        phase = "speech";
        events.push({ type: "speech.start" });
      }
    } else {
      silenceRun += int16Frame.length;
      if (silenceRun >= silenceSamplesLimit) {
        if (started) {
          events.push({ type: "speech.end", audio: concatFrames(segment) });
        }
        // shorter than minSpeechMs → discard silently
        goIdle();
      }
    }

    return events;
  };

  const reset = () => {
    goIdle();
    if (typeof runner.reset === "function") runner.reset();
  };

  return Object.freeze({ push, reset });
};

export const loadSileroSession = async ({
  modelPath,
  ortModule,
  importFn,
  sampleRate = 16000
} = {}) => {
  if (!modelPath) {
    throw new Error("loadSileroSession requires modelPath to a silero_vad.onnx file");
  }
  let ort = ortModule;
  if (!ort) {
    try {
      ort = await importOrt(importFn);
    } catch (cause) {
      throw new Error(
        "onnxruntime-node is not available. Install it with `npm install onnxruntime-node` " +
          "and download silero_vad.onnx from https://github.com/snakers4/silero-vad " +
          `(modelPath: ${modelPath}).`,
        { cause }
      );
    }
  }
  const session = await ort.InferenceSession.create(modelPath);
  return Object.freeze(
    createOrtFrameRunner({ session, sampleRate, ortModule: ort })
  );
};
