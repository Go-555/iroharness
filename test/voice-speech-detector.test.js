import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import {
  wrapVadSttDetector,
  createAzureStreamDetector,
} from "../src/voice-pipeline/speech-detector.js";

const FRAME_SAMPLES = 512;
const FRAME = new Int16Array(FRAME_SAMPLES).fill(7);
const FRAME_BYTES = FRAME_SAMPLES * 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Fake Azure Speech SDK — records PushAudioInputStream writes and lets tests
// fire recognizing/recognized/canceled/sessionStopped on the live recognizer.
// ---------------------------------------------------------------------------

const createFakeSdk = () => {
  const streams = [];
  const recognizers = [];
  const speechConfigs = [];

  class FakeRecognizer {
    constructor(speechConfig, audioConfig) {
      this.speechConfig = speechConfig;
      this.audioConfig = audioConfig;
      this.started = false;
      this.stopped = false;
      this.closed = false;
      this.recognizing = null;
      this.recognized = null;
      this.canceled = null;
      this.sessionStopped = null;
      recognizers.push(this);
    }

    startContinuousRecognitionAsync(onSuccess) {
      this.started = true;
      onSuccess?.();
    }

    stopContinuousRecognitionAsync(onSuccess) {
      this.stopped = true;
      onSuccess?.();
    }

    close() {
      this.closed = true;
    }

    // --- test controls ---
    fireRecognizing(text) {
      this.recognizing?.(this, { result: { text } });
    }

    fireRecognized(text, reason = "RecognizedSpeech") {
      this.recognized?.(this, { result: { text, reason } });
    }

    fireNoMatch() {
      this.recognized?.(this, { result: { text: "", reason: "NoMatch" } });
    }

    fireCanceled(details = "boom") {
      this.canceled?.(this, { reason: "Error", errorDetails: details });
    }

    fireSessionStopped() {
      this.sessionStopped?.(this, {});
    }
  }

  const sdk = {
    PropertyId: {
      Speech_SegmentationSilenceTimeoutMs:
        "Speech_SegmentationSilenceTimeoutMs",
    },
    ResultReason: {
      RecognizedSpeech: "RecognizedSpeech",
      NoMatch: "NoMatch",
    },
    SpeechConfig: {
      fromSubscription(subscriptionKey, region) {
        const config = {
          subscriptionKey,
          region,
          speechRecognitionLanguage: null,
          properties: {},
          setProperty(name, value) {
            config.properties[name] = value;
          },
        };
        speechConfigs.push(config);
        return config;
      },
    },
    AudioStreamFormat: {
      getWaveFormatPCM: (samplesPerSecond, bitsPerSample, channels) => ({
        samplesPerSecond,
        bitsPerSample,
        channels,
      }),
    },
    AudioInputStream: {
      createPushStream(format) {
        const stream = {
          format,
          writes: [],
          closed: false,
          write(arrayBuffer) {
            stream.writes.push(arrayBuffer);
          },
          close() {
            stream.closed = true;
          },
        };
        streams.push(stream);
        return stream;
      },
    },
    AudioConfig: {
      fromStreamInput: (stream) => ({ stream }),
    },
    SpeechRecognizer: FakeRecognizer,
  };

  const writtenBytes = (stream) =>
    stream.writes.reduce((total, buf) => total + buf.byteLength, 0);

  return { sdk, streams, recognizers, speechConfigs, writtenBytes };
};

// Scripted gate: each push() dequeues a scripted event batch (mirrors the
// silero vad contract used by gated mode).
const createScriptedGate = () => {
  const queue = [];
  const resets = [];
  return {
    resets,
    gate: Object.freeze({
      push: async () => queue.shift() ?? [],
      reset: () => resets.push(true),
    }),
    script: (events) => queue.push(events),
  };
};

const azureDetector = (overrides = {}) => {
  const fake = createFakeSdk();
  const detector = createAzureStreamDetector({
    subscriptionKey: "test-key",
    region: "japaneast",
    sdk: fake.sdk,
    mode: "continuous",
    ...overrides,
  });
  return { ...fake, detector };
};

// ---------------------------------------------------------------------------
// Contract validation
// ---------------------------------------------------------------------------

test("createAzureStreamDetector validates its options", () => {
  const { sdk } = createFakeSdk();
  assert.throws(
    () => createAzureStreamDetector({ region: "japaneast", sdk }),
    /subscriptionKey/,
  );
  assert.throws(
    () => createAzureStreamDetector({ subscriptionKey: "k", sdk }),
    /region/,
  );
  assert.throws(
    () =>
      createAzureStreamDetector({
        subscriptionKey: "k",
        region: "r",
        mode: "bogus",
        sdk,
      }),
    /mode/,
  );
  // gated requires a gate instance
  assert.throws(
    () =>
      createAzureStreamDetector({
        subscriptionKey: "k",
        region: "r",
        mode: "gated",
        sdk,
      }),
    /gate/,
  );
});

test("wrapVadSttDetector validates vad and stt", () => {
  assert.throws(() => wrapVadSttDetector({ stt: { start: () => {} } }), /vad/);
  assert.throws(
    () => wrapVadSttDetector({ vad: { push: async () => [] } }),
    /stt/,
  );
});

// ---------------------------------------------------------------------------
// Continuous mode
// ---------------------------------------------------------------------------

test("continuous mode: partial → start → end-with-text flow", async () => {
  const { detector, streams, recognizers } = azureDetector();

  // first push lazily opens the connection and writes the frame
  let events = await detector.push(FRAME);
  assert.deepEqual(events, []);
  assert.equal(recognizers.length, 1);
  assert.equal(recognizers[0].started, true);
  assert.equal(streams[0].writes.length, 1);
  assert.equal(streams[0].writes[0].byteLength, FRAME_BYTES);

  // recognizing → speech.start (first of the utterance) + transcript.partial
  recognizers[0].fireRecognizing("こん");
  events = await detector.push(FRAME);
  assert.deepEqual(events, [
    { type: "speech.start" },
    { type: "transcript.partial", text: "こん" },
  ]);

  // later recognizing → partial only (speech.start already emitted)
  recognizers[0].fireRecognizing("こんにち");
  events = await detector.push(FRAME);
  assert.deepEqual(events, [{ type: "transcript.partial", text: "こんにち" }]);

  // recognized → speech.end with the final text
  recognizers[0].fireRecognized("こんにちは。");
  events = await detector.push(FRAME);
  assert.deepEqual(events, [{ type: "speech.end", text: "こんにちは。" }]);

  // next utterance gets a fresh speech.start
  recognizers[0].fireRecognizing("つぎ");
  events = await detector.push(FRAME);
  assert.deepEqual(events, [
    { type: "speech.start" },
    { type: "transcript.partial", text: "つぎ" },
  ]);

  // the connection stayed up the whole time (continuous = one session)
  assert.equal(recognizers.length, 1);
  await detector.close();
});

test("continuous mode: SDK plumbing (subscription, language, segmentation, format)", async () => {
  const { detector, streams, speechConfigs } = azureDetector({
    language: "en-US",
    segmentationSilenceMs: 800,
    sampleRate: 24000,
  });
  await detector.push(FRAME);

  assert.equal(speechConfigs.length, 1);
  assert.equal(speechConfigs[0].subscriptionKey, "test-key");
  assert.equal(speechConfigs[0].region, "japaneast");
  assert.equal(speechConfigs[0].speechRecognitionLanguage, "en-US");
  assert.equal(
    speechConfigs[0].properties.Speech_SegmentationSilenceTimeoutMs,
    "800",
  );
  assert.deepEqual(streams[0].format, {
    samplesPerSecond: 24000,
    bitsPerSample: 16,
    channels: 1,
  });
  await detector.close();
});

test("continuous mode: recognized empty / NoMatch closes the utterance without text", async () => {
  const { detector, recognizers } = azureDetector();
  await detector.push(FRAME);
  recognizers[0].fireRecognizing("はな");
  await detector.push(FRAME);
  recognizers[0].fireNoMatch();
  const events = await detector.push(FRAME);
  assert.deepEqual(events, [{ type: "speech.end" }]);
  await detector.close();
});

test("continuous mode: canceled drops the session and the next push reconnects", async () => {
  const { detector, recognizers, streams } = azureDetector();
  await detector.push(FRAME);
  assert.equal(recognizers.length, 1);

  recognizers[0].fireCanceled("network glitch");
  const events = await detector.push(FRAME);
  // a fresh recognizer + stream were created and the frame went to the new one
  assert.equal(recognizers.length, 2);
  assert.equal(recognizers[1].started, true);
  assert.equal(streams[1].writes.length, 1);
  assert.deepEqual(events, []);
  await detector.close();
});

// ---------------------------------------------------------------------------
// Gated mode
// ---------------------------------------------------------------------------

test("gated mode only writes speech-segment + preroll bytes to the stream", async () => {
  const scripted = createScriptedGate();
  const { detector, streams, recognizers, writtenBytes } = azureDetector({
    mode: "gated",
    gate: scripted.gate,
    prerollFrames: 3,
  });

  // 5 idle frames — nothing reaches Azure, no session is opened
  for (let i = 0; i < 5; i += 1) {
    scripted.script([]);
    assert.deepEqual(await detector.push(FRAME), []);
  }
  assert.equal(streams.length, 0);
  assert.equal(recognizers.length, 0);

  // gate opens: session starts, preroll ring (3 frames) + this frame written
  scripted.script([{ type: "speech.start" }]);
  let events = await detector.push(FRAME);
  assert.deepEqual(events, [{ type: "speech.start" }]);
  assert.equal(recognizers.length, 1);
  assert.equal(streams[0].writes.length, 4);

  // 2 live frames while the gate stays open
  scripted.script([]);
  await detector.push(FRAME);
  scripted.script([]);
  await detector.push(FRAME);
  assert.equal(streams[0].writes.length, 6);

  // gate closes: the closing frame is still written, then the input closes
  scripted.script([{ type: "speech.end" }]);
  await detector.push(FRAME);
  assert.equal(streams[0].writes.length, 7);
  assert.equal(streams[0].closed, true);

  // total: 10 pushed frames + 1 closing frame = 11 pushed, 7 written
  // (preroll 3 + start frame + 2 live + closing frame)
  assert.equal(writtenBytes(streams[0]), 7 * FRAME_BYTES);

  // idle frames after the utterance never reach the (closed) stream
  recognizers[0].fireRecognized("どうも。");
  scripted.script([]);
  await detector.push(FRAME);
  assert.equal(streams[0].writes.length, 7);
  await detector.close();
});

test("gated mode: gate end THEN recognized → exactly one speech.end with the final text", async () => {
  const scripted = createScriptedGate();
  const { detector, recognizers } = azureDetector({
    mode: "gated",
    gate: scripted.gate,
  });

  scripted.script([{ type: "speech.start" }]);
  await detector.push(FRAME);
  recognizers[0].fireRecognizing("やあ");
  scripted.script([]);
  const partials = await detector.push(FRAME);
  assert.deepEqual(partials, [{ type: "transcript.partial", text: "やあ" }]);

  // gate closes before the recognizer finalizes — no speech.end yet
  scripted.script([{ type: "speech.end" }]);
  let events = await detector.push(FRAME);
  assert.deepEqual(events, []);

  // the final text arrives → speech.end with it, once
  recognizers[0].fireRecognized("やあ、いろは。");
  scripted.script([]);
  events = await detector.push(FRAME);
  assert.deepEqual(events, [{ type: "speech.end", text: "やあ、いろは。" }]);

  // the per-utterance session is torn down (billing only for speech)
  assert.equal(recognizers[0].stopped, true);

  // no second speech.end ever shows up
  scripted.script([]);
  assert.deepEqual(await detector.push(FRAME), []);
  await detector.close();
});

test("gated mode: recognized THEN gate end → exactly one speech.end with the final text", async () => {
  const scripted = createScriptedGate();
  const { detector, recognizers } = azureDetector({
    mode: "gated",
    gate: scripted.gate,
  });

  scripted.script([{ type: "speech.start" }]);
  await detector.push(FRAME);
  recognizers[0].fireRecognizing("やあ");
  recognizers[0].fireRecognized("やあ、いろは。"); // azure segments before silero closes
  scripted.script([]);
  const events1 = await detector.push(FRAME);
  assert.deepEqual(events1, [{ type: "transcript.partial", text: "やあ" }]);

  scripted.script([{ type: "speech.end" }]);
  const events2 = await detector.push(FRAME);
  assert.deepEqual(events2, [{ type: "speech.end", text: "やあ、いろは。" }]);
  assert.equal(recognizers[0].stopped, true);

  scripted.script([]);
  assert.deepEqual(await detector.push(FRAME), []);
  await detector.close();
});

test("gated mode: timeout fallback emits speech.end with the accumulated partial text", async () => {
  const scripted = createScriptedGate();
  const { detector, recognizers } = azureDetector({
    mode: "gated",
    gate: scripted.gate,
    finalizeTimeoutMs: 20,
  });

  scripted.script([{ type: "speech.start" }]);
  await detector.push(FRAME);
  recognizers[0].fireRecognizing("とちゅうまで");
  scripted.script([{ type: "speech.end" }]);
  const atEnd = await detector.push(FRAME);
  assert.deepEqual(atEnd, [
    { type: "transcript.partial", text: "とちゅうまで" },
  ]);

  await sleep(40); // recognizer never finalizes — the fallback timer fires
  scripted.script([]);
  const events = await detector.push(FRAME);
  assert.deepEqual(events, [
    { type: "speech.end", text: "とちゅうまで", fallback: true },
  ]);

  // a late recognized after the timeout must not produce a second speech.end
  recognizers[0].fireRecognized("とちゅうまでだった。");
  scripted.script([]);
  assert.deepEqual(await detector.push(FRAME), []);
  await detector.close();
});

test("gated mode: timeout fallback with no partial emits speech.end without text", async () => {
  const scripted = createScriptedGate();
  const { detector } = azureDetector({
    mode: "gated",
    gate: scripted.gate,
    finalizeTimeoutMs: 20,
  });

  scripted.script([{ type: "speech.start" }]);
  await detector.push(FRAME);
  scripted.script([{ type: "speech.end" }]);
  await detector.push(FRAME);

  await sleep(40);
  scripted.script([]);
  const events = await detector.push(FRAME);
  assert.deepEqual(events, [{ type: "speech.end", fallback: true }]);
  await detector.close();
});

test("gated mode: re-trigger during awaitingFinal force-finishes the dying utterance on a fresh session", async () => {
  const scripted = createScriptedGate();
  const { detector, streams, recognizers } = azureDetector({
    mode: "gated",
    gate: scripted.gate,
    finalizeTimeoutMs: 5000, // must never fire — the re-trigger finishes u1
  });

  // utterance 1: start → partial → gate end (recognized never arrives)
  scripted.script([{ type: "speech.start" }]);
  await detector.push(FRAME);
  recognizers[0].fireRecognizing("いち");
  scripted.script([{ type: "speech.end" }]);
  await detector.push(FRAME);
  assert.equal(streams[0].closed, true);
  const u1Writes = streams[0].writes.length;

  // utterance 2 starts DURING u1's awaitingFinal window: u1 force-finishes
  // with its accumulated partial BEFORE u2's speech.start, and u2 gets a
  // FRESH session (the dying one's pushStream is closed — writing there
  // would silently drop u2's audio).
  scripted.script([{ type: "speech.start" }]);
  const events = await detector.push(FRAME);
  assert.deepEqual(events, [
    { type: "speech.end", text: "いち" },
    { type: "speech.start" },
  ]);
  assert.equal(recognizers.length, 2);
  assert.equal(streams.length, 2);
  assert.equal(recognizers[0].stopped, true);
  assert.equal(streams[1].writes.length, 1); // u2's trigger frame, new stream
  assert.equal(streams[0].writes.length, u1Writes); // dead stream untouched

  // u1's recognizer finalizing late must not leak a second speech.end
  recognizers[0].fireRecognized("いちばんめ。");
  scripted.script([]);
  assert.deepEqual(await detector.push(FRAME), []);
  assert.equal(streams[1].writes.length, 2); // u2 keeps streaming

  // u2 completes normally with exactly one speech.end of its own
  recognizers[1].fireRecognized("にばんめ。");
  scripted.script([{ type: "speech.end" }]);
  assert.deepEqual(await detector.push(FRAME), [
    { type: "speech.end", text: "にばんめ。" },
  ]);
  await detector.close();
});

// ---------------------------------------------------------------------------
// onEvent push-delivery (idle-flush) — late events surface without a push
// ---------------------------------------------------------------------------

test("createAzureStreamDetector rejects a non-function onEvent", () => {
  const { sdk } = createFakeSdk();
  assert.throws(
    () =>
      createAzureStreamDetector({
        subscriptionKey: "k",
        region: "r",
        mode: "continuous",
        sdk,
        onEvent: 123,
      }),
    /onEvent/,
  );
});

test("onEvent: continuous late recognized reaches onEvent with NO subsequent push", async () => {
  const received = [];
  const { detector, recognizers } = azureDetector({
    onEvent: (event) => received.push(event),
  });

  // push() returns [] in onEvent mode — events go out via the callback
  assert.deepEqual(await detector.push(FRAME), []);

  // these callbacks fire AFTER the last push — the mic has gone silent
  recognizers[0].fireRecognizing("こん");
  recognizers[0].fireRecognized("こんにちは。");

  assert.deepEqual(received, [
    { type: "speech.start" },
    { type: "transcript.partial", text: "こん" },
    { type: "speech.end", text: "こんにちは。" },
  ]);
  await detector.close();
});

test("onEvent: exactly-once — push() returns [] and the queue never double-delivers", async () => {
  const received = [];
  const { detector, recognizers } = azureDetector({
    onEvent: (event) => received.push(event),
  });

  await detector.push(FRAME);
  recognizers[0].fireRecognizing("や");
  // a subsequent push must NOT re-deliver the already-flushed partial
  assert.deepEqual(await detector.push(FRAME), []);
  recognizers[0].fireRecognized("やあ。");
  assert.deepEqual(await detector.push(FRAME), []);

  assert.deepEqual(received, [
    { type: "speech.start" },
    { type: "transcript.partial", text: "や" },
    { type: "speech.end", text: "やあ。" },
  ]);
  await detector.close();
});

test("onEvent: gated late recognized reaches onEvent after the gate already closed", async () => {
  const received = [];
  const scripted = createScriptedGate();
  const { detector, recognizers } = azureDetector({
    mode: "gated",
    gate: scripted.gate,
    onEvent: (event) => received.push(event),
  });

  scripted.script([{ type: "speech.start" }]);
  await detector.push(FRAME);
  recognizers[0].fireRecognizing("やあ");
  scripted.script([{ type: "speech.end" }]);
  // gate closed before recognized — no speech.end yet, awaitingFinal window open
  await detector.push(FRAME);
  assert.deepEqual(received, [
    { type: "speech.start" },
    { type: "transcript.partial", text: "やあ" },
  ]);

  // recognized fires with NO following push (mic muted) — must still surface
  recognizers[0].fireRecognized("やあ、いろは。");
  assert.deepEqual(received, [
    { type: "speech.start" },
    { type: "transcript.partial", text: "やあ" },
    { type: "speech.end", text: "やあ、いろは。" },
  ]);
  await detector.close();
});

test("onEvent null (default): events still surface only via the push() return", async () => {
  const { detector, recognizers } = azureDetector();
  await detector.push(FRAME);
  recognizers[0].fireRecognizing("こん");
  recognizers[0].fireRecognized("こんにちは。");
  // pull mode unchanged — everything drains on the next push
  assert.deepEqual(await detector.push(FRAME), [
    { type: "speech.start" },
    { type: "transcript.partial", text: "こん" },
    { type: "speech.end", text: "こんにちは。" },
  ]);
  await detector.close();
});

// ---------------------------------------------------------------------------
// reset / close
// ---------------------------------------------------------------------------

test("reset clears queued events, tears the session down, and resets the gate", async () => {
  const scripted = createScriptedGate();
  const { detector, recognizers } = azureDetector({
    mode: "gated",
    gate: scripted.gate,
  });

  scripted.script([{ type: "speech.start" }]);
  await detector.push(FRAME);
  recognizers[0].fireRecognizing("すて"); // queued, never drained

  detector.reset();
  assert.equal(scripted.resets.length, 1);
  assert.equal(recognizers[0].stopped, true);

  // the queued partial is gone and the utterance state is fresh
  scripted.script([]);
  assert.deepEqual(await detector.push(FRAME), []);
  await detector.close();
});

test("close stops the recognizer and closes the push stream", async () => {
  const { detector, recognizers, streams } = azureDetector();
  await detector.push(FRAME);
  await detector.close();
  assert.equal(recognizers[0].stopped, true);
  assert.equal(recognizers[0].closed, true);
  assert.equal(streams[0].closed, true);

  // close is idempotent
  await detector.close();
});

// ---------------------------------------------------------------------------
// Lazy import
// ---------------------------------------------------------------------------

test("missing SDK surfaces a helpful install message on first push", async () => {
  const detector = createAzureStreamDetector({
    subscriptionKey: "k",
    region: "r",
    mode: "continuous",
    importSdk: async () => {
      throw new Error("Cannot find module");
    },
  });
  await assert.rejects(
    () => detector.push(FRAME),
    /npm install microsoft-cognitiveservices-speech-sdk/,
  );
});

// ---------------------------------------------------------------------------
// wrapVadSttDetector (silero + batch STT parity)
// ---------------------------------------------------------------------------

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
          },
        });
      },
    }),
  };
};

test("wrapVadSttDetector adapts vad speech.end into speech.end with batch STT text", async () => {
  const scripted = createScriptedGate(); // same shape as a scripted vad
  const utterance = new Int16Array(1600).fill(3);
  const mockStt = createMockStt("こんにちは、いろは");
  const detector = wrapVadSttDetector({
    vad: scripted.gate,
    stt: mockStt.stt,
    sampleRate: 16000,
  });

  scripted.script([{ type: "speech.start" }]);
  assert.deepEqual(await detector.push(FRAME), [{ type: "speech.start" }]);

  scripted.script([{ type: "speech.end", audio: utterance }]);
  const events = await detector.push(FRAME);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "speech.end");
  assert.equal(events[0].text, "こんにちは、いろは");
  assert.equal(events[0].audio, utterance);

  // the batch STT got the exact pcm_s16le payload the pipeline used to send
  assert.equal(mockStt.calls.length, 1);
  assert.equal(mockStt.calls[0].audio.encoding, "pcm_s16le");
  assert.equal(mockStt.calls[0].audio.sampleRate, 16000);
  assert.equal(
    mockStt.calls[0].audio.dataBase64,
    Buffer.from(
      utterance.buffer,
      utterance.byteOffset,
      utterance.byteLength,
    ).toString("base64"),
  );
  await detector.close();
});

test("wrapVadSttDetector: empty transcription yields speech.end with empty text", async () => {
  const scripted = createScriptedGate();
  const mockStt = createMockStt("");
  const detector = wrapVadSttDetector({ vad: scripted.gate, stt: mockStt.stt });

  scripted.script([{ type: "speech.end", audio: new Int16Array(512) }]);
  const events = await detector.push(FRAME);
  assert.deepEqual(
    events.map(({ type, text }) => ({ type, text })),
    [{ type: "speech.end", text: "" }],
  );
});

test('wrapVadSttDetector: stt failures reject push with stage "stt"', async () => {
  const scripted = createScriptedGate();
  const detector = wrapVadSttDetector({
    vad: scripted.gate,
    stt: {
      start: () => ({
        push: async () => {
          throw new Error("stt boom");
        },
        end: async () => [],
      }),
    },
  });
  scripted.script([{ type: "speech.end", audio: new Int16Array(512) }]);
  await assert.rejects(
    () => detector.push(FRAME),
    (error) => {
      assert.match(error.message, /stt boom/);
      assert.equal(error.stage, "stt");
      return true;
    },
  );
});

test("wrapVadSttDetector: slow stt rejects with the stt timeout", async () => {
  const scripted = createScriptedGate();
  const detector = wrapVadSttDetector({
    vad: scripted.gate,
    stt: {
      start: () => ({
        push: async () => [],
        end: () => new Promise(() => {}), // never settles
      }),
    },
    timeoutMs: 20,
  });
  scripted.script([{ type: "speech.end", audio: new Int16Array(512) }]);
  await assert.rejects(
    () => detector.push(FRAME),
    (error) => {
      assert.match(error.message, /stt timed out after 20ms/);
      assert.equal(error.stage, "stt");
      return true;
    },
  );
});

test("wrapVadSttDetector: reset forwards to the vad", async () => {
  const scripted = createScriptedGate();
  const { stt } = createMockStt();
  const detector = wrapVadSttDetector({ vad: scripted.gate, stt });
  detector.reset();
  assert.equal(scripted.resets.length, 1);
  await detector.close(); // no-op, must not throw
});
