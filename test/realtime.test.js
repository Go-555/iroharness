import assert from "node:assert/strict";
import test from "node:test";

import {
  createRealtimeLatencyTracker,
  createRealtimeVoiceSession,
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
