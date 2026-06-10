import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceTurnMetrics } from "../src/voice-pipeline/metrics.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const makeClock = (initial = 0) => {
  let t = initial;
  return {
    nowFn: () => t,
    set: (v) => { t = v; },
    advance: (ms) => { t += ms; },
  };
};

// ---------------------------------------------------------------------------
// 1. Full turn: all marks at known fake times → exact diffs for all six keys
// ---------------------------------------------------------------------------
test("full turn snapshot returns exact diffs for all six keys", () => {
  const clock = makeClock();
  const m = createVoiceTurnMetrics({ nowFn: clock.nowFn });

  clock.set(100);  m.mark("speech.start");
  clock.set(900);  m.mark("speech.end");
  clock.set(1200); m.mark("stt.final");
  clock.set(1700); m.mark("llm.first_sentence");
  clock.set(2100); m.mark("tts.first_audio");
  clock.set(3500); m.mark("response.final");

  const s = m.snapshot();

  // vad_close_ms  = speech.end − speech.start = 900 − 100 = 800
  assert.equal(s.vad_close_ms, 800);
  // stt_ms        = stt.final − speech.end    = 1200 − 900 = 300
  assert.equal(s.stt_ms, 300);
  // llm_first_sentence_ms = llm.first_sentence − stt.final = 1700 − 1200 = 500
  assert.equal(s.llm_first_sentence_ms, 500);
  // tts_first_audio_ms = tts.first_audio − llm.first_sentence = 2100 − 1700 = 400
  assert.equal(s.tts_first_audio_ms, 400);
  // first_audio_total_ms = tts.first_audio − speech.end = 2100 − 900 = 1200
  assert.equal(s.first_audio_total_ms, 1200);
  // total_ms      = response.final − speech.end = 3500 − 900 = 2600
  assert.equal(s.total_ms, 2600);
});

// ---------------------------------------------------------------------------
// 2. Missing marks → affected keys are null; available ones compute normally
// ---------------------------------------------------------------------------
test("missing marks leave those keys null but present combos compute", () => {
  const clock = makeClock();
  const m = createVoiceTurnMetrics({ nowFn: clock.nowFn });

  // Only mark speech.end and tts.first_audio
  clock.set(500);  m.mark("speech.end");
  clock.set(1800); m.mark("tts.first_audio");

  const s = m.snapshot();

  // speech.start missing → vad_close_ms null
  assert.equal(s.vad_close_ms, null);
  // stt.final missing → stt_ms null
  assert.equal(s.stt_ms, null);
  // llm.first_sentence missing → llm_first_sentence_ms null
  assert.equal(s.llm_first_sentence_ms, null);
  // tts_first_audio_ms = tts.first_audio − llm.first_sentence; llm missing → null
  assert.equal(s.tts_first_audio_ms, null);
  // first_audio_total_ms = tts.first_audio − speech.end = 1800 − 500 = 1300
  assert.equal(s.first_audio_total_ms, 1300);
  // response.final missing → total_ms null
  assert.equal(s.total_ms, null);
});

// ---------------------------------------------------------------------------
// 3. Duplicate mark keeps FIRST timestamp
// ---------------------------------------------------------------------------
test("duplicate mark keeps first timestamp", () => {
  const clock = makeClock();
  const m = createVoiceTurnMetrics({ nowFn: clock.nowFn });

  clock.set(900);  m.mark("speech.end");
  clock.set(100);  m.mark("tts.first_audio"); // first: t=100
  clock.set(200);  m.mark("tts.first_audio"); // second: should be ignored

  const s = m.snapshot();
  // first_audio_total_ms = 100 − 900 = −800 (negative is fine; first wins)
  assert.equal(s.first_audio_total_ms, 100 - 900);
});

// ---------------------------------------------------------------------------
// 4. reset() clears all marks → snapshot returns all null
// ---------------------------------------------------------------------------
test("reset clears all marks so snapshot returns all null", () => {
  const clock = makeClock();
  const m = createVoiceTurnMetrics({ nowFn: clock.nowFn });

  clock.set(100); m.mark("speech.start");
  clock.set(900); m.mark("speech.end");

  m.reset();

  const s = m.snapshot();
  assert.equal(s.vad_close_ms, null);
  assert.equal(s.stt_ms, null);
  assert.equal(s.llm_first_sentence_ms, null);
  assert.equal(s.tts_first_audio_ms, null);
  assert.equal(s.first_audio_total_ms, null);
  assert.equal(s.total_ms, null);
});

// ---------------------------------------------------------------------------
// 5. No NaN anywhere even with zero marks
// ---------------------------------------------------------------------------
test("snapshot with zero marks has no NaN values — all null", () => {
  const m = createVoiceTurnMetrics();
  const s = m.snapshot();
  const values = Object.values(s);
  assert.ok(values.length > 0, "snapshot should return at least one key");
  for (const v of values) {
    assert.ok(v === null || typeof v === "number",
      `unexpected type ${typeof v} for value ${v}`);
    if (typeof v === "number") {
      assert.ok(!Number.isNaN(v), `NaN found in snapshot key`);
    }
  }
  // All must be null when no marks
  assert.ok(values.every((v) => v === null), "all values should be null");
});

// ---------------------------------------------------------------------------
// 6. Unknown mark names are stored (forward-compat) — no throw
// ---------------------------------------------------------------------------
test("unknown mark names are stored without throwing", () => {
  const clock = makeClock();
  const m = createVoiceTurnMetrics({ nowFn: clock.nowFn });

  assert.doesNotThrow(() => {
    clock.set(42); m.mark("custom.event");
    clock.set(99); m.mark("another.future.mark");
  });

  // Known snapshot keys still all null (no recognized marks set)
  const s = m.snapshot();
  assert.equal(s.vad_close_ms, null);
});

// ---------------------------------------------------------------------------
// 7. Returns a frozen object (shape check)
// ---------------------------------------------------------------------------
test("snapshot returns a plain object with exactly the six documented keys", () => {
  const m = createVoiceTurnMetrics();
  const s = m.snapshot();
  const keys = Object.keys(s).sort();
  assert.deepEqual(keys, [
    "first_audio_total_ms",
    "llm_first_sentence_ms",
    "stt_ms",
    "total_ms",
    "tts_first_audio_ms",
    "vad_close_ms",
  ]);
});

// ---------------------------------------------------------------------------
// 8. Factory is frozen and exposes only mark / snapshot / reset
// ---------------------------------------------------------------------------
test("createVoiceTurnMetrics with no args uses default nowFn (no throw)", () => {
  assert.doesNotThrow(() => {
    const m = createVoiceTurnMetrics();
    m.mark("speech.start");
    m.mark("speech.end");
    m.snapshot();
    m.reset();
  });
  const m = createVoiceTurnMetrics();
  assert.ok(Object.isFrozen(m), "factory result must be frozen");
  assert.deepEqual(Object.keys(m).sort(), ["mark", "reset", "snapshot"]);
});
