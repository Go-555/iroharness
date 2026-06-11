// Per-stage voice-turn latency metrics.
//
// createVoiceTurnMetrics({ nowFn? }) → frozen { mark(name), snapshot(), reset() }
//
// Recognized mark names for one voice turn:
//   "speech.start", "speech.end", "stt.final",
//   "llm.first_sentence", "tts.first_audio", "response.final"
//
// Snapshot keys:
//   vad_close_ms          = speech.end − speech.start
//   stt_ms                = stt.final − speech.end
//   llm_first_sentence_ms = llm.first_sentence − stt.final
//   tts_first_audio_ms    = tts.first_audio − llm.first_sentence
//   first_audio_total_ms  = tts.first_audio − speech.end   ← headline metric
//   total_ms              = response.final − speech.end
//
// Any value whose required marks are absent → null (never NaN).
// Marking the same name twice keeps the FIRST timestamp.
// Unknown names are stored too (forward-compat) — no throw.
//
// NOT built on createRealtimeLatencyTracker (src/index.js): that tracker is
// last-wins and measure() throws on missing marks; this turn recorder needs
// first-wins (first audio chunk) and null-tolerant snapshots.

const diff = (marks, start, end) => {
  const s = marks[start];
  const e = marks[end];
  return typeof s === "number" && typeof e === "number" ? e - s : null;
};

export const createVoiceTurnMetrics = ({
  nowFn = () => performance.now(),
} = {}) => {
  let marks = {};

  const mark = (name) => {
    // Keep the first timestamp — ignore subsequent marks for the same name.
    if (!Object.prototype.hasOwnProperty.call(marks, name)) {
      marks[name] = nowFn();
    }
  };

  const snapshot = () =>
    Object.freeze({
      vad_close_ms: diff(marks, "speech.start", "speech.end"),
      stt_ms: diff(marks, "speech.end", "stt.final"),
      llm_first_sentence_ms: diff(marks, "stt.final", "llm.first_sentence"),
      tts_first_audio_ms: diff(marks, "llm.first_sentence", "tts.first_audio"),
      first_audio_total_ms: diff(marks, "speech.end", "tts.first_audio"),
      total_ms: diff(marks, "speech.end", "response.final"),
    });

  const reset = () => {
    marks = {};
  };

  return Object.freeze({ mark, snapshot, reset });
};
