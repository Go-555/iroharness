import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import { createVoicePipeline } from "../src/voice-pipeline/pipeline.js";
import { createVoiceTurnMetrics } from "../src/voice-pipeline/metrics.js";

const FRAME = new Int16Array(512);
const UTTERANCE = new Int16Array(1600);

const b64 = (text) => Buffer.from(text).toString("base64");

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const until = async (condition, { tries = 500 } = {}) => {
  for (let i = 0; i < tries; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("until: condition never became true");
};

const createGate = () => {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

const createEventSink = () => {
  const events = [];
  const waiters = [];
  const onEvent = (event) => {
    events.push(event);
    for (const probe of [...waiters]) probe();
  };
  return {
    events,
    onEvent,
    emitted: (type) => events.filter((event) => event.type === type),
    waitFor: (predicate) =>
      new Promise((resolve) => {
        const probe = () => {
          const hit = events.find(predicate);
          if (hit) resolve(hit);
        };
        probe();
        waiters.push(probe);
      })
  };
};

// VAD mock: each push() dequeues a scripted event batch (or none).
const createScriptedVad = () => {
  const queue = [];
  return {
    vad: Object.freeze({
      push: async () => queue.shift() ?? [],
      reset: () => {}
    }),
    script: (events) => queue.push(events)
  };
};

const createMockStt = (text = "やあ、いろは") => {
  const calls = [];
  return {
    calls,
    stt: Object.freeze({
      start({ onEvent = () => {} } = {}) {
        return Object.freeze({
          async push(payload) {
            calls.push(payload);
            return [];
          },
          async end() {
            const event = { type: "stt.final", text };
            onEvent(event);
            return [event];
          }
        });
      }
    })
  };
};

// TTS mock: records calls; optional per-text gates and failures; shared log.
const createMockTts = ({
  failTexts = [],
  gates = new Map(),
  encoding = "pcm16",
  log = null
} = {}) => {
  const calls = [];
  return {
    calls,
    tts: Object.freeze({
      async stream({ text, voice, onEvent = () => {}, signal }) {
        calls.push({ text, voice, signal });
        log?.push(`tts:${text}`);
        const gate = gates.get(text);
        if (gate) await gate.promise;
        if (failTexts.includes(text)) {
          throw new Error(`tts boom: ${text}`);
        }
        onEvent({
          type: "tts.audio",
          audio: b64(`audio:${text}`),
          encoding
        });
        return [];
      }
    })
  };
};

const createMockHarness = ({ makeStream, gateResult = null } = {}) => {
  const calls = [];
  const finalized = [];
  const state = { abandonCount: 0 };
  return {
    calls,
    finalized,
    state,
    harness: Object.freeze({
      async receiveStream(input, { signal } = {}) {
        calls.push({ input, signal });
        if (gateResult) {
          return { stream: null, result: gateResult };
        }
        return {
          stream: makeStream({ signal }),
          finalize: async (fullText) => {
            finalized.push(fullText);
            return { text: fullText };
          },
          abandon: () => {
            state.abandonCount += 1;
          }
        };
      }
    })
  };
};

const streamOfDeltas = (deltas) =>
  async function* () {
    for (const delta of deltas) {
      yield { delta };
    }
  };

const buildInput = (transcript) => ({
  source: "test",
  modality: "voice",
  text: transcript
});

const setup = ({
  deltas = ["こんにちは。"],
  makeStream = null,
  gateResult = null,
  sttText = "やあ、いろは",
  ttsOptions = {},
  pipelineOptions = {}
} = {}) => {
  const scripted = createScriptedVad();
  const mockStt = createMockStt(sttText);
  const mockTts = createMockTts(ttsOptions);
  const mockHarness = createMockHarness({
    makeStream: makeStream ?? (() => streamOfDeltas(deltas)()),
    gateResult
  });
  const sink = createEventSink();
  const pipeline = createVoicePipeline({
    vad: scripted.vad,
    stt: mockStt.stt,
    harness: mockHarness.harness,
    tts: mockTts.tts,
    buildInput,
    onEvent: sink.onEvent,
    ...pipelineOptions
  });
  return { scripted, mockStt, mockTts, mockHarness, sink, pipeline };
};

const pushUtterance = async (pipeline, scripted) => {
  scripted.script([{ type: "speech.start" }]);
  await pipeline.pushAudio(FRAME);
  scripted.script([{ type: "speech.end", audio: UTTERANCE }]);
  await pipeline.pushAudio(FRAME);
};

test("requires buildInput and core dependencies", () => {
  const { vad } = createScriptedVad();
  const { stt } = createMockStt();
  const { tts } = createMockTts();
  const { harness } = createMockHarness({ makeStream: () => streamOfDeltas([])() });
  assert.throws(
    () => createVoicePipeline({ vad, stt, harness, tts }),
    /buildInput/
  );
  assert.throws(
    () => createVoicePipeline({ stt, harness, tts, buildInput }),
    /vad/
  );
  assert.throws(
    () => createVoicePipeline({ vad, harness, tts, buildInput }),
    /stt/
  );
  assert.throws(
    () => createVoicePipeline({ vad, stt, tts, buildInput }),
    /harness/
  );
  assert.throws(
    () => createVoicePipeline({ vad, stt, harness, buildInput }),
    /tts/
  );
});

test("speaks the first sentence before the brain releases its second delta", async () => {
  // 並走の証明: tts for 文一 fires the gate that lets the brain emit 文二.
  // If the pipeline buffered the whole response, the gate would never open.
  const log = [];
  const secondDelta = createGate();
  const makeStream = () =>
    (async function* () {
      log.push("delta:文一。");
      yield { delta: "文一。" };
      await secondDelta.promise;
      log.push("delta:文二。");
      yield { delta: "文二。" };
    })();
  const ttsCalls = [];
  const tts = {
    async stream({ text, onEvent = () => {} }) {
      ttsCalls.push(text);
      log.push(`tts:${text}`);
      if (text === "文一。") secondDelta.release();
      onEvent({ type: "tts.audio", audio: b64(`audio:${text}`), encoding: "pcm16" });
      return [];
    }
  };
  const scripted = createScriptedVad();
  const mockStt = createMockStt();
  const mockHarness = createMockHarness({ makeStream });
  const sink = createEventSink();
  const pipeline = createVoicePipeline({
    vad: scripted.vad,
    stt: mockStt.stt,
    harness: mockHarness.harness,
    tts,
    buildInput,
    onEvent: sink.onEvent
  });

  await pushUtterance(pipeline, scripted);
  await sink.waitFor((event) => event.type === "turn.final");

  const ttsFirst = log.indexOf("tts:文一。");
  const deltaSecond = log.indexOf("delta:文二。");
  assert.ok(ttsFirst >= 0, "tts for 文一 must have started");
  assert.ok(deltaSecond >= 0, "brain must have released 文二");
  assert.ok(
    ttsFirst < deltaSecond,
    `tts for 文一 (${ttsFirst}) must start before the brain's second delta (${deltaSecond}); log=${JSON.stringify(log)}`
  );
  assert.deepEqual(ttsCalls, ["文一。", "文二。"]);
  assert.deepEqual(mockHarness.finalized, ["文一。文二。"]);
  assert.equal(
    sink.emitted("turn.final")[0].text,
    "文一。文二。"
  );
});

test("manual barge-in aborts tts, abandons the turn, and stops speech", async () => {
  const gate = createGate();
  const { scripted, mockTts, mockHarness, sink, pipeline } = setup({
    deltas: ["文一。"],
    ttsOptions: { gates: new Map([["文一。", gate]]) }
  });

  await pushUtterance(pipeline, scripted);
  await until(() => mockTts.calls.length === 1);

  pipeline.interrupt("manual-stop");
  gate.release();
  await settle();

  assert.equal(mockTts.calls[0].signal.aborted, true, "tts signal must be aborted");
  const interrupted = sink.emitted("speech.interrupted");
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].reason, "manual-stop");
  assert.equal(mockHarness.state.abandonCount, 1, "abandon() must be called");
  assert.equal(sink.emitted("speech.audio").length, 0, "no speech.audio after barge-in");
  assert.equal(sink.emitted("turn.final").length, 0, "interrupted turn never finalizes");
  assert.equal(pipeline.snapshot().state, "idle");
});

test("auto barge-in: speech.start while speaking aborts the running turn", async () => {
  const gate = createGate();
  const { scripted, mockTts, mockHarness, sink, pipeline } = setup({
    deltas: ["文一。"],
    ttsOptions: { gates: new Map([["文一。", gate]]) }
  });

  await pushUtterance(pipeline, scripted);
  await until(() => mockTts.calls.length === 1);

  scripted.script([{ type: "speech.start" }]);
  await pipeline.pushAudio(FRAME);
  gate.release();
  await settle();

  assert.equal(mockTts.calls[0].signal.aborted, true, "tts signal must be aborted");
  assert.equal(sink.emitted("speech.interrupted").length, 1);
  assert.equal(mockHarness.state.abandonCount, 1, "abandon() must be called");
  assert.equal(sink.emitted("speech.audio").length, 0, "no speech.audio after barge-in");
  assert.equal(pipeline.snapshot().state, "listening", "mic keeps running into the new utterance");
});

test("a tts failure on one sentence is reported and the next sentence still speaks", async () => {
  const { scripted, sink, pipeline } = setup({
    deltas: ["文一。文二。"],
    ttsOptions: { failTexts: ["文一。"] }
  });

  await pushUtterance(pipeline, scripted);
  await sink.waitFor((event) => event.type === "turn.final");

  const errors = sink.events.filter((event) => event.type === "error" && event.stage === "tts");
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /文一。/);
  assert.deepEqual(
    sink.emitted("speech.audio").map((event) => event.text),
    ["文二。"]
  );
});

test("maxSentences guard stops consumption, aborts the brain, and reports once", async () => {
  const { scripted, mockTts, mockHarness, sink, pipeline } = setup({
    deltas: ["一。二。三。"],
    pipelineOptions: { maxSentences: 2 }
  });

  await pushUtterance(pipeline, scripted);
  await sink.waitFor((event) => event.type === "turn.final");

  assert.deepEqual(
    sink.emitted("speech.audio").map((event) => event.text),
    ["一。", "二。"]
  );
  const guards = sink.events.filter((event) => event.type === "error" && event.stage === "guard");
  assert.equal(guards.length, 1);
  assert.equal(mockHarness.calls[0].signal.aborted, true, "brain signal must be aborted");
  assert.equal(mockTts.calls.length, 2, "third sentence never reaches tts");
});

test("whitespace-only sentences are skipped, never sent to tts", async () => {
  const { scripted, mockTts, sink, pipeline } = setup({
    deltas: ["見出し\n", "\n", "- 項目\n"]
  });

  await pushUtterance(pipeline, scripted);
  await sink.waitFor((event) => event.type === "turn.final");

  assert.deepEqual(
    mockTts.calls.map((call) => call.text),
    ["見出し\n", "- 項目\n"]
  );
  assert.equal(
    sink.emitted("speech.audio").some((event) => event.text.trim() === ""),
    false
  );
});

test("empty stt result emits stt.empty and never calls the brain", async () => {
  const { scripted, mockTts, mockHarness, sink, pipeline } = setup({ sttText: "" });

  await pushUtterance(pipeline, scripted);
  await sink.waitFor((event) => event.type === "stt.empty");
  await settle();

  assert.equal(mockHarness.calls.length, 0, "receiveStream must not be called");
  assert.equal(mockTts.calls.length, 0);
  assert.equal(sink.emitted("turn.final").length, 0);
  assert.equal(pipeline.snapshot().state, "idle");
});

test("gate rejection surfaces turn.rejected and skips tts", async () => {
  const gateResult = { handled: false, reason: "persona-gate" };
  const { scripted, mockTts, sink, pipeline } = setup({ gateResult });

  await pushUtterance(pipeline, scripted);
  const rejected = await sink.waitFor((event) => event.type === "turn.rejected");
  await settle();

  assert.deepEqual(rejected.result, gateResult);
  assert.equal(mockTts.calls.length, 0);
  assert.equal(sink.emitted("turn.final").length, 0);
});

test("a turn with no speakable sentence falls back to the fallback phrase", async () => {
  const { scripted, mockTts, mockHarness, sink, pipeline } = setup({
    deltas: [""]
  });

  await pushUtterance(pipeline, scripted);
  await sink.waitFor((event) => event.type === "turn.final");

  assert.deepEqual(
    mockTts.calls.map((call) => call.text),
    ["少々調子が悪いや。"]
  );
  assert.deepEqual(
    sink.emitted("speech.audio").map((event) => event.text),
    ["少々調子が悪いや。"]
  );
  const errors = sink.events.filter((event) => event.type === "error" && event.stage === "brain");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "empty response");
  assert.deepEqual(mockHarness.finalized, [""]);
});

test("a brain that throws mid-turn keeps spoken sentences and speaks the fallback", async () => {
  const makeStream = () =>
    (async function* () {
      yield { delta: "言いかけ。" };
      throw new Error("brain died");
    })();
  const { scripted, sink, pipeline } = setup({ makeStream });

  await pushUtterance(pipeline, scripted);
  await sink.waitFor((event) => event.type === "turn.final");

  assert.deepEqual(
    sink.emitted("speech.audio").map((event) => event.text),
    ["言いかけ。", "少々調子が悪いや。"]
  );
  const errors = sink.events.filter((event) => event.type === "error" && event.stage === "brain");
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /brain died/);
  assert.equal(sink.emitted("turn.final")[0].text, "言いかけ。");
});

test("brain inactivity timeout trips the fallback but keeps spoken sentences", async () => {
  const makeStream = () =>
    (async function* () {
      yield { delta: "言いかけ。" };
      await new Promise(() => {}); // brain goes silent — never yields again
    })();
  const { scripted, mockHarness, sink, pipeline } = setup({
    makeStream,
    pipelineOptions: { stageTimeoutMs: { brain: 25 } }
  });

  await pushUtterance(pipeline, scripted);
  const final = await sink.waitFor((event) => event.type === "turn.final");

  assert.deepEqual(
    sink.emitted("speech.audio").map((event) => event.text),
    ["言いかけ。", "少々調子が悪いや。"]
  );
  const errors = sink.events.filter((event) => event.type === "error" && event.stage === "brain");
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /brain timed out/);
  assert.equal(mockHarness.calls[0].signal.aborted, true, "silent brain must be aborted");
  assert.deepEqual(mockHarness.finalized, ["言いかけ。"], "finalize with partial text");
  assert.equal(final.text, "言いかけ。");
});

test("slow tts/pacing does not count against the brain inactivity timeout", async () => {
  // Two sentences, each taking 60ms of tts time, under a 30ms brain timeout:
  // a wall-clock guard would trip here; the inactivity guard must not.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const tts = {
    async stream({ text, onEvent = () => {} }) {
      await sleep(60);
      onEvent({ type: "tts.audio", audio: b64(`audio:${text}`), encoding: "pcm16" });
      return [];
    }
  };
  const scripted = createScriptedVad();
  const mockStt = createMockStt();
  const mockHarness = createMockHarness({
    makeStream: () => streamOfDeltas(["一。", "二。"])()
  });
  const sink = createEventSink();
  const pipeline = createVoicePipeline({
    vad: scripted.vad,
    stt: mockStt.stt,
    harness: mockHarness.harness,
    tts,
    buildInput,
    onEvent: sink.onEvent,
    stageTimeoutMs: { brain: 30 }
  });

  await pushUtterance(pipeline, scripted);
  const final = await sink.waitFor((event) => event.type === "turn.final");

  assert.deepEqual(
    sink.emitted("speech.audio").map((event) => event.text),
    ["一。", "二。"]
  );
  assert.equal(sink.events.filter((event) => event.type === "error").length, 0);
  assert.equal(final.text, "一。二。");
});

test("metrics reset on new utterance: the turn after a barge-in gets clean marks", async () => {
  let now = 0;
  const metrics = createVoiceTurnMetrics({ nowFn: () => (now += 10) });
  const gate = createGate();
  const { scripted, mockTts, sink, pipeline } = setup({
    deltas: ["応答。"],
    ttsOptions: { gates: new Map([["応答。", gate]]) },
    pipelineOptions: { metrics }
  });

  // turn 1 — runs until its sentence is mid-tts
  await pushUtterance(pipeline, scripted);
  await until(() => mockTts.calls.length === 1);

  // turn 2's utterance starts: auto barge-in + metrics reset boundary
  scripted.script([{ type: "speech.start" }]);
  await pipeline.pushAudio(FRAME);
  gate.release(); // turn 1's orphaned tts resumes — must not stamp marks
  await settle();

  scripted.script([{ type: "speech.end", audio: UTTERANCE }]);
  await pipeline.pushAudio(FRAME);
  const final = await sink.waitFor((event) => event.type === "turn.final");

  // nowFn ticks +10 per mark; all six marks belong to turn 2 alone.
  assert.deepEqual(final.metrics, {
    vad_close_ms: 10,
    stt_ms: 10,
    llm_first_sentence_ms: 10,
    tts_first_audio_ms: 10,
    first_audio_total_ms: 30,
    total_ms: 40
  });
});

test("full happy turn records metrics and resets them after turn.final", async () => {
  let now = 0;
  const metrics = createVoiceTurnMetrics({ nowFn: () => (now += 10) });
  const quickResponder = {
    fire: () => ({ text: "うん。", audio: b64("quick"), encoding: "wav" })
  };
  const { scripted, mockHarness, sink, pipeline } = setup({
    deltas: ["了解。"],
    pipelineOptions: { metrics, quickResponder }
  });

  await pushUtterance(pipeline, scripted);
  const final = await sink.waitFor((event) => event.type === "turn.final");
  await settle();

  assert.ok(final.metrics, "turn.final carries a metrics snapshot");
  assert.equal(typeof final.metrics.first_audio_total_ms, "number");
  assert.equal(typeof final.metrics.total_ms, "number");
  assert.equal(typeof final.metrics.stt_ms, "number");
  assert.equal(typeof final.metrics.vad_close_ms, "number");
  assert.equal(typeof final.metrics.llm_first_sentence_ms, "number");
  // metrics reset after snapshot: a fresh snapshot is all nulls
  assert.equal(metrics.snapshot().total_ms, null);

  const speech = sink.emitted("speech.audio");
  assert.equal(speech[0].quick, true, "quick responder audio comes first");
  assert.equal(speech[0].text, "うん。");
  assert.deepEqual(speech[0].audio, { encoding: "wav", dataBase64: b64("quick") });
  assert.equal(speech[1].text, "了解。");

  assert.deepEqual(mockHarness.calls[0].input, {
    source: "test",
    modality: "voice",
    text: "やあ、いろは"
  });
  assert.deepEqual(pipeline.snapshot(), { state: "idle", turnCount: 1 });
});

test("paces each sentence by the base64 byte-length/2 approximation before emitting", async () => {
  const paces = [];
  const resets = [];
  const pacer = Object.freeze({
    pace: async (sampleCount) => {
      paces.push(sampleCount);
    },
    reset: () => resets.push(true)
  });
  const { scripted, sink, pipeline } = setup({
    deltas: ["了解。"],
    pipelineOptions: { pacer }
  });

  await pushUtterance(pipeline, scripted);
  await sink.waitFor((event) => event.type === "turn.final");

  const expectedSamples = Math.floor(Buffer.byteLength("audio:了解。") / 2);
  assert.deepEqual(paces, [expectedSamples]);
  assert.ok(resets.length >= 1, "pacer.reset() after the turn");
  // speech.audio still emitted after pacing
  assert.deepEqual(
    sink.emitted("speech.audio").map((event) => event.text),
    ["了解。"]
  );
});

test("interrupt while idle is a safe no-op", async () => {
  const { sink, pipeline } = setup();
  pipeline.interrupt("nothing-running");
  await settle(2);
  assert.deepEqual(sink.events, []);
  assert.deepEqual(pipeline.snapshot(), { state: "idle", turnCount: 0 });
});

test("a new utterance while a turn is running interrupts the old turn (new wins)", async () => {
  const gate = createGate();
  const { scripted, mockTts, mockHarness, sink, pipeline } = setup({
    deltas: ["文一。"],
    ttsOptions: { gates: new Map([["文一。", gate]]) }
  });

  await pushUtterance(pipeline, scripted);
  await until(() => mockTts.calls.length === 1);

  // second utterance arrives while the first turn is mid-sentence
  scripted.script([{ type: "speech.end", audio: UTTERANCE }]);
  await pipeline.pushAudio(FRAME);
  gate.release();
  await sink.waitFor((event) => event.type === "turn.final");
  await settle();

  assert.equal(sink.emitted("speech.interrupted").length, 1);
  assert.equal(mockHarness.state.abandonCount, 1, "first turn abandoned");
  assert.equal(mockHarness.calls.length, 2, "second turn reached the brain");
  assert.equal(pipeline.snapshot().turnCount, 2);
  // only the second turn's sentence is spoken (first was aborted mid-tts)
  assert.deepEqual(
    sink.emitted("speech.audio").map((event) => event.text),
    ["文一。"]
  );
});

test("passes voice and transcript audio through to tts and stt", async () => {
  const { scripted, mockStt, mockTts, sink, pipeline } = setup({
    deltas: ["了解。"],
    pipelineOptions: { voice: "custom-voice" }
  });

  await pushUtterance(pipeline, scripted);
  await sink.waitFor((event) => event.type === "turn.final");

  assert.equal(mockTts.calls[0].voice, "custom-voice");
  assert.equal(mockStt.calls.length, 1);
  assert.equal(mockStt.calls[0].audio.encoding, "pcm_s16le");
  assert.equal(mockStt.calls[0].audio.sampleRate, 16000);
  assert.equal(
    mockStt.calls[0].audio.dataBase64,
    Buffer.from(UTTERANCE.buffer, UTTERANCE.byteOffset, UTTERANCE.byteLength).toString("base64")
  );
});

test("vad errors are normalized to error events, pushAudio never throws", async () => {
  const sink = createEventSink();
  const { stt } = createMockStt();
  const { tts } = createMockTts();
  const { harness } = createMockHarness({ makeStream: () => streamOfDeltas([])() });
  const pipeline = createVoicePipeline({
    vad: { push: async () => { throw new Error("bad frame"); }, reset: () => {} },
    stt,
    harness,
    tts,
    buildInput,
    onEvent: sink.onEvent
  });
  await pipeline.pushAudio(FRAME);
  const errors = sink.events.filter((event) => event.type === "error");
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /bad frame/);
});
