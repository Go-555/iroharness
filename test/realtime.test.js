import assert from "node:assert/strict";
import test from "node:test";

import {
  createJavascriptRealtimeCore,
  createHttpStreamingStt,
  createHttpStreamingTts,
  createRealtimeEventBus,
  createRealtimeLatencyTracker,
  createRealtimeVoiceSession,
  createRustRealtimeCoreCabiAdapter,
  createRustRealtimeCoreBinding,
  createSpeechPlaybackQueue,
  createTextStreamingStt,
  createTextStreamingTts
} from "../src/index.js";

test("streaming STT emits partial and final transcript events", () => {
  const events = [];
  const stt = createTextStreamingStt({ id: "stt-test" });
  const session = stt.start({
    onEvent(event) {
      events.push(event);
    }
  });

  const first = session.push("こん");
  const second = session.push("にちは");
  const final = session.end();

  assert.equal(stt.kind, "stt");
  assert.equal(first.type, "stt.partial");
  assert.equal(second.text, "こんにちは");
  assert.equal(final.type, "stt.final");
  assert.equal(final.text, "こんにちは");
  assert.equal(events.length, 3);
});

test("streaming TTS emits audio chunks and a completion event", async () => {
  const events = [];
  const tts = createTextStreamingTts({
    id: "tts-test",
    chunkSize: 3
  });

  const chunks = await tts.stream({
    text: "abcdefg",
    voice: "iroha",
    onEvent(event) {
      events.push(event);
    }
  });

  assert.equal(tts.kind, "tts");
  assert.equal(chunks.filter((event) => event.type === "tts.audio").length, 3);
  assert.equal(chunks.at(-1).type, "tts.completed");
  assert.equal(events.at(0).audio, "abc");
  assert.equal(events.at(-1).voice, "iroha");
});

test("streaming TTS can be interrupted by an AbortSignal", async () => {
  const controller = new AbortController();
  const events = [];
  const tts = createTextStreamingTts({
    id: "tts-test",
    chunkSize: 2
  });

  const chunks = await tts.stream({
    text: "abcdef",
    signal: controller.signal,
    onEvent(event) {
      events.push(event);
      if (event.type === "tts.audio") {
        controller.abort("barge-in");
      }
    }
  });

  assert.equal(chunks.at(-1).type, "tts.interrupted");
  assert.equal(chunks.at(-1).reason, "barge-in");
  assert.equal(events.filter((event) => event.type === "tts.audio").length, 1);
});

test("HTTP streaming STT posts chunks and emits provider events", async () => {
  const requests = [];
  const events = [];
  const stt = createHttpStreamingStt({
    id: "http-stt-test",
    endpoint: "http://stt.local/transcribe",
    fetchImpl: async (endpoint, options) => {
      requests.push({ endpoint, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            events: [
              {
                type: "stt.partial",
                text: "こん",
                delta: "こん",
                final: false
              }
            ]
          });
        }
      };
    }
  });
  const session = stt.start({
    onEvent(event) {
      events.push(event);
    }
  });

  const emitted = await session.push({ audio: "base64-audio" });

  assert.equal(stt.kind, "stt");
  assert.equal(requests[0].endpoint, "http://stt.local/transcribe");
  assert.equal(requests[0].body.audio, "base64-audio");
  assert.equal(emitted[0].type, "stt.partial");
  assert.equal(events[0].adapterId, "http-stt-test");
});

test("HTTP streaming TTS posts text and emits audio chunks", async () => {
  const requests = [];
  const events = [];
  const tts = createHttpStreamingTts({
    id: "http-tts-test",
    endpoint: "http://tts.local/speak",
    fetchImpl: async (endpoint, options) => {
      requests.push({ endpoint, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            chunks: [
              { text: "こん", audio: "audio-1" },
              { text: "にちは", audio: "audio-2" }
            ]
          });
        }
      };
    }
  });

  const chunks = await tts.stream({
    text: "こんにちは",
    voice: "iroha",
    onEvent(event) {
      events.push(event);
    }
  });

  assert.equal(tts.kind, "tts");
  assert.equal(requests[0].endpoint, "http://tts.local/speak");
  assert.equal(requests[0].body.text, "こんにちは");
  assert.equal(requests[0].body.voice, "iroha");
  assert.equal(chunks.filter((event) => event.type === "tts.audio").length, 2);
  assert.equal(chunks.at(-1).type, "tts.completed");
  assert.equal(events[0].audio, "audio-1");
});

test("speech playback queue simulates ordered body playback", () => {
  const events = [];
  const queue = createSpeechPlaybackQueue({
    id: "speech-queue-test",
    onEvent(event) {
      events.push(event);
    }
  });

  const first = queue.enqueue({ text: "先に話す", voice: "iroha" });
  const second = queue.enqueue({ text: "次に話す", voice: "iroha" });
  const firstDone = queue.complete(first.id);
  const interrupted = queue.interrupt("barge-in");
  const snapshot = queue.snapshot();

  assert.equal(queue.kind, "speech-playback-queue");
  assert.equal(second.id, "speech-queue-test:speech:1");
  assert.equal(firstDone.type, "speech.completed");
  assert.equal(interrupted.item.id, second.id);
  assert.equal(snapshot.current, null);
  assert.equal(snapshot.pending.length, 0);
  assert.deepEqual(
    events.map((event) => event.type),
    ["speech.queued", "speech.started", "speech.queued", "speech.completed", "speech.started", "speech.interrupted"]
  );
});

test("realtime latency tracker records turn timing metrics", () => {
  const times = [1000, 1015, 1080, 1130];
  const tracker = createRealtimeLatencyTracker({
    clock: () => times.shift()
  });

  tracker.mark("audio.received");
  tracker.mark("stt.final");
  tracker.mark("llm.first_token");
  tracker.mark("tts.first_audio");

  const stt = tracker.measure("stt.final_ms", "audio.received", "stt.final");
  const firstAudio = tracker.measure("first_audio_ms", "audio.received", "tts.first_audio");
  const snapshot = tracker.snapshot();

  assert.equal(stt.durationMs, 15);
  assert.equal(firstAudio.durationMs, 130);
  assert.equal(snapshot.measures.length, 2);
});

test("realtime event bus keeps a bounded event snapshot", () => {
  const bus = createRealtimeEventBus({
    id: "bus-test",
    capacity: 2,
    clock: () => "2026-05-25T00:00:00.000Z"
  });

  bus.publish({ type: "one" });
  bus.publish({ type: "two" });
  bus.publish({ type: "three" });

  const snapshot = bus.snapshot();
  assert.deepEqual(
    snapshot.events.map((event) => event.type),
    ["two", "three"]
  );
  assert.equal(snapshot.events.at(-1).busId, "bus-test");
});

test("JavaScript realtime core exposes the Rust core runtime contract", () => {
  const core = createJavascriptRealtimeCore({
    id: "js-core-test",
    eventCapacity: 1,
    clock: () => 100
  });

  core.publish({ type: "realtime.listening" });
  core.mark("audio.received");
  core.startSpeaking();
  const interrupted = core.shouldInterrupt({
    type: "stt.partial",
    delta: "待って"
  });

  const snapshot = core.snapshot();
  assert.equal(core.kind, "realtime-core");
  assert.equal(interrupted, true);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.latency.marks["audio.received"], 100);
  assert.equal(snapshot.bargeIn.interrupted, true);
});

test("Rust realtime core binding delegates to native core when available", () => {
  const calls = [];
  const binding = createRustRealtimeCoreBinding({
    native: {
      id: "native-core",
      implementation: "rust-napi-test",
      capabilities: ["event-bus"],
      publish(event) {
        calls.push(["publish", event.type]);
        return event;
      },
      mark(name, at) {
        calls.push(["mark", name, at]);
        return { name, at };
      },
      startSpeaking() {
        calls.push(["startSpeaking"]);
      },
      finishSpeaking() {
        calls.push(["finishSpeaking"]);
      },
      shouldInterrupt(event) {
        calls.push(["shouldInterrupt", event.type]);
        return event.type === "stt.partial";
      },
      snapshot() {
        return { implementation: "rust-napi-test", calls };
      }
    }
  });

  binding.publish({ type: "realtime.speaking" });
  binding.mark("tts.start", 42);
  binding.startSpeaking();
  const interrupted = binding.shouldInterrupt({ type: "stt.partial", delta: "待って" });
  binding.finishSpeaking();

  assert.equal(binding.resolve().implementation, "rust-napi-test");
  assert.equal(interrupted, true);
  assert.deepEqual(calls[0], ["publish", "realtime.speaking"]);
  assert.deepEqual(calls[1], ["mark", "tts.start", 42]);
});

test("Rust realtime core C ABI adapter wraps native or WASM exports", () => {
  let nextHandle = 40;
  const handles = new Map();
  const exports = {
    iroharness_realtime_core_new(capacity) {
      nextHandle += 1;
      handles.set(nextHandle, {
        capacity,
        events: [],
        speaking: false,
        interrupted: false,
        freed: false
      });
      return nextHandle;
    },
    iroharness_realtime_core_publish(handle, kindCode) {
      const state = handles.get(handle);
      const sequence = state.events.length;
      state.events.push(kindCode);
      state.events = state.events.slice(-state.capacity);
      return sequence;
    },
    iroharness_realtime_core_events_len(handle) {
      return handles.get(handle).events.length;
    },
    iroharness_realtime_core_start_speaking(handle) {
      const state = handles.get(handle);
      state.speaking = true;
      state.interrupted = false;
    },
    iroharness_realtime_core_finish_speaking(handle) {
      handles.get(handle).speaking = false;
    },
    iroharness_realtime_core_observe_stt_partial_len(handle, textLen) {
      const state = handles.get(handle);
      const shouldInterrupt = state.speaking && textLen > 0;
      if (shouldInterrupt) {
        state.interrupted = true;
        state.speaking = false;
      }
      return shouldInterrupt;
    },
    iroharness_realtime_core_interrupted(handle) {
      return handles.get(handle).interrupted;
    },
    iroharness_realtime_core_free(handle) {
      handles.get(handle).freed = true;
    }
  };

  const core = createRustRealtimeCoreCabiAdapter({
    id: "rust-cabi-test",
    exports,
    eventCapacity: 2,
    timestamp: () => "2026-05-27T00:00:00.000Z"
  });

  core.publish({ type: "realtime.listening" });
  core.publish({ type: "tts.audio" });
  core.startSpeaking();
  const interrupted = core.shouldInterrupt({ type: "stt.partial", delta: "待って" });
  const snapshot = core.snapshot();
  core.close();

  assert.equal(core.implementation, "rust-cabi");
  assert.equal(interrupted, true);
  assert.equal(snapshot.native.eventsLen, 2);
  assert.equal(snapshot.native.interrupted, true);
  assert.deepEqual(
    snapshot.events.map((event) => event.nativeSequence),
    [0, 1]
  );
  assert.equal([...handles.values()][0].freed, true);
});

test("Rust realtime core binding auto-wraps C ABI exports", () => {
  const exports = {
    iroharness_realtime_core_new() {
      return 1;
    },
    iroharness_realtime_core_publish() {
      return 0;
    },
    iroharness_realtime_core_events_len() {
      return 1;
    }
  };
  const binding = createRustRealtimeCoreBinding({ native: { exports } });

  binding.publish({ type: "tts.audio" });

  assert.equal(binding.resolve().implementation, "rust-cabi");
  assert.equal(binding.snapshot().native.eventsLen, 1);
});

test("realtime voice session can publish through a Rust core binding", async () => {
  const core = createRustRealtimeCoreBinding({
    fallbackCore: createJavascriptRealtimeCore({ id: "fallback-core" })
  });
  const session = createRealtimeVoiceSession({
    stt: createTextStreamingStt({ id: "stt-test" }),
    tts: createTextStreamingTts({ id: "tts-test", chunkSize: 2 }),
    realtimeCore: core
  });

  const listening = session.listen();
  listening.push("あ");
  await session.speak({ text: "hello", voice: "iroha" });

  const snapshot = core.snapshot();
  assert.equal(snapshot.implementation, "javascript");
  assert.equal(snapshot.events.some((event) => event.type === "realtime.listening"), true);
  assert.equal(snapshot.events.some((event) => event.type === "tts.audio"), true);
  assert.equal(typeof snapshot.latency.marks["audio.received"], "number");
});

test("realtime voice session interrupts TTS when STT detects barge-in", async () => {
  const events = [];
  let session = null;
  session = createRealtimeVoiceSession({
    stt: createTextStreamingStt({ id: "stt-test" }),
    tts: createTextStreamingTts({ id: "tts-test", chunkSize: 2 }),
    onEvent(event) {
      events.push(event);
      if (event.type === "tts.audio") {
        session.handleSttEvent({
          type: "stt.partial",
          text: "待って",
          delta: "待って",
          final: false
        });
      }
    }
  });

  const chunks = await session.speak({
    text: "abcdef",
    voice: "iroha"
  });

  assert.equal(chunks.at(-1).type, "tts.interrupted");
  assert.equal(events.some((event) => event.type === "realtime.barge_in"), true);
  assert.equal(events.some((event) => event.type === "realtime.interrupted"), true);
  assert.equal(session.state().interruptedCount, 1);
});

test("realtime voice session wires STT listening events and latency marks", () => {
  const events = [];
  const session = createRealtimeVoiceSession({
    stt: createTextStreamingStt({ id: "stt-test" }),
    tts: createTextStreamingTts({ id: "tts-test" }),
    onEvent(event) {
      events.push(event);
    }
  });

  const listening = session.listen();
  listening.push("こん");
  listening.end();

  const latency = session.latency();
  assert.equal(events.some((event) => event.type === "realtime.listening"), true);
  assert.equal(events.some((event) => event.type === "stt.final"), true);
  assert.equal(typeof latency.marks["audio.received"], "number");
  assert.equal(typeof latency.marks["stt.final"], "number");
});
