// Streaming voice pipeline orchestrator.
//
// createVoicePipeline({ vad, stt, detector = null, harness, tts, pacer = null,
//                       quickResponder = null, metrics = null, voice = "iroha",
//                       buildInput, maxSentences = 30, sampleRate = 16000,
//                       stageTimeoutMs = { stt: 10000, brain: 30000, tts: 10000 },
//                       fallbackPhrase = "少々調子が悪いや。", onEvent = () => {} })
//   → frozen { pushAudio(int16Frame), interrupt(reason), snapshot(),
//              handleDetectorEvent(event) }
//
// handleDetectorEvent(event) is the single sink for one detector event. The
// push() return array is fed through it (pull mode / wrapVadSttDetector), and
// it doubles as the detector's onEvent target (azure-stream push mode): wire
// createAzureStreamDetector({ onEvent: pipeline.handleDetectorEvent }) so a
// late speech.end / final recognized result surfaces even when the mic has
// stopped sending frames (server speaking, or PTT release) and no further
// push() would drain the queue. The detector's exactly-once contract ensures
// each event flows through ONE channel, so the pipeline never double-handles.
//
// Composes: speech detector (VAD + STT as one unit) → harness.receiveStream
// (brain stream) → sentence-splitter → tts adapter, with optional pacer /
// quick-responder / metrics.
//
// Input front-end: pass `detector` (speech-detector.js contract, e.g.
// createAzureStreamDetector) OR the legacy `vad` + `stt` pair, which is
// wrapped with wrapVadSttDetector internally (same behavior as before:
// batch STT on speech.end, bounded by stageTimeoutMs.stt). When `detector`
// is given, vad/stt are ignored. Detector transcript.partial events surface
// as onEvent({ type: "stt.partial", text }) — the session handler forwards
// them to the wire.
//
// Flow per utterance ("the turn", runs in the background so the mic loop keeps
// feeding pushAudio — that is what makes auto barge-in possible):
//   1. detector speech.end carries the final transcription (streaming STT,
//      or the wrapped batch STT). Empty text → stt.empty, stop.
//   2. Quick ack, never paced: quickResponder.fireFor(text, { signal }) when
//      present (dynamic — awaited, bounded by its own ~1.5s deadline), else
//      quickResponder?.fire() (static, zero-latency). Emitted with quick: true.
//   3. harness.receiveStream(buildInput(text, { quickText }), { signal }).
//      quickText is the ack text (or null) so the session handler can add a
//      continuation instruction. Gate-rejected ({ stream: null, result }) →
//      turn.rejected, stop.
//   4. Stream deltas → sentence splitter → per closed sentence: tts.stream
//      (timeout stageTimeoutMs.tts) → optional pacer.pace → onEvent speech.audio.
//      Whitespace-only sentences are skipped (Markdown "\n" noise). maxSentences
//      caps runaway turns (abort + one error stage:"guard").
//   5. One sentence's tts failure → error stage:"tts", next sentence continues.
//   6. Brain death / inactivity timeout / zero speakable sentences →
//      fallbackPhrase via tts (best effort), error stage:"brain", finalize
//      with partial text.
//   7. finalize(fullText) → turn.final { text, metrics } → pacer/metrics reset.
//
// stageTimeoutMs.brain is an INACTIVITY timeout: it bounds the gap between
// consecutive brain deltas, not the wall-clock of the whole turn — tts and
// pacing time never count against the brain, so a long healthy answer is safe.
//
// Callers must await pushAudio serially (one mic loop) — detector.push
// assumes a single frame in flight. With the wrapped batch STT the mic loop
// blocks for the STT duration on speech.end (frames buffer at the caller).
//
// barge-in (interrupt() or detector speech.start while a turn runs) fires BOTH the
// per-turn AbortSignal and the latched abandon() — abandon alone only resets
// harness state; without the signal the brain keeps burning tokens.
//
// buildInput(transcript, { quickText }) is REQUIRED: the session handler owns
// platform specifics (source/actor/metadata) — the pipeline never hardcodes
// them. The second arg is additive (quickText: ack text or null); existing
// single-arg callbacks keep working.
//
// Pacing approximation: sampleCount = decoded base64 byte length / 2 (PCM16).
// For "wav" payloads the same approximation is used — the header bytes inflate
// the estimate by <1% on real utterances, which only makes pacing slightly
// more conservative (never starves the device).
//
// Per-sentence synthesis captures the FIRST tts.audio event only — this
// assumes adapters that emit one audio event per stream() call (mock, Aivis).
// A multi-chunk streaming TTS adapter would lose later chunks.
//
// Documented assumption: after a stage timeout (a tts.stream() that outlives
// stageTimeoutMs.tts, or a brain delta resolving after the inactivity timeout)
// the orphaned operation is discarded but may still be running — an orphaned
// speak can briefly overlap the fallback synthesis against the same tts
// adapter. Adapters are expected to tolerate concurrent stream() calls.
//
// Errors never escape pushAudio — every failure is normalized to
// onEvent({ type: "error", stage, message }).

import { Buffer } from "node:buffer";

import { createSentenceSplitter } from "./sentence-splitter.js";
import { wrapVadSttDetector } from "./speech-detector.js";

const DEFAULT_STAGE_TIMEOUT_MS = { stt: 10000, brain: 30000, tts: 10000 };

const message = (error) => String(error?.message ?? error);

const withTimeout = (promise, ms, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const base64SampleCount = (dataBase64) =>
  Math.floor(Buffer.from(dataBase64, "base64").length / 2);

export const createVoicePipeline = ({
  vad = null,
  stt = null,
  detector = null,
  harness,
  tts,
  pacer = null,
  quickResponder = null,
  metrics = null,
  voice = "iroha",
  buildInput,
  maxSentences = 30,
  sampleRate = 16000,
  stageTimeoutMs = {},
  fallbackPhrase = "少々調子が悪いや。",
  onEvent = () => {}
} = {}) => {
  if (detector) {
    if (typeof detector.push !== "function") {
      throw new Error("createVoicePipeline requires detector with push(int16Frame)");
    }
  } else {
    if (!vad || typeof vad.push !== "function") {
      throw new Error("createVoicePipeline requires vad with push(int16Frame)");
    }
    if (!stt || typeof stt.start !== "function") {
      throw new Error("createVoicePipeline requires stt with start({ onEvent })");
    }
  }
  if (!harness || typeof harness.receiveStream !== "function") {
    throw new Error("createVoicePipeline requires harness with receiveStream(input, { signal })");
  }
  if (!tts || typeof tts.stream !== "function") {
    throw new Error("createVoicePipeline requires tts with stream({ text, onEvent })");
  }
  if (typeof buildInput !== "function") {
    throw new Error("createVoicePipeline requires buildInput(transcript)");
  }

  const timeouts = { ...DEFAULT_STAGE_TIMEOUT_MS, ...stageTimeoutMs };

  // One input front-end either way: the legacy vad+stt pair becomes a
  // detector. metrics threading keeps the speech.end / stt.final marks at
  // their true times even though the batch STT now runs inside push()
  // (the pipeline's own later marks are first-wins no-ops).
  const speechDetector =
    detector ??
    wrapVadSttDetector({ vad, stt, sampleRate, timeoutMs: timeouts.stt, metrics });

  let state = "idle"; // "idle" | "listening" | "speaking"
  let turnCount = 0;
  let active = null; // { controller, abandon, interrupted }

  const emitError = (stage, error) => {
    onEvent({ type: "error", stage, message: message(error) });
  };

  // Synthesize one sentence and emit speech.audio. `force` is the fallback
  // path: the signal may already be aborted by a guard/brain failure, but the
  // apology must still go out (interrupts always win via turn.interrupted).
  const speak = async (turn, ctx, sentence, { force = false } = {}) => {
    try {
      let captured = null;
      const args = {
        text: sentence,
        voice,
        onEvent: (event) => {
          if (event.type === "tts.audio" && captured === null) {
            captured = {
              encoding: event.encoding ?? "wav",
              dataBase64: event.audio
            };
          }
        }
      };
      if (!force) {
        args.signal = turn.controller.signal;
      }
      await withTimeout(tts.stream(args), timeouts.tts, "tts");
      // Check abort BEFORE marking: an interrupted turn's in-flight synthesis
      // resuming late must not stamp marks into the next utterance's metrics.
      if (turn.interrupted || (!force && turn.controller.signal.aborted)) {
        return;
      }
      if (!captured) {
        throw new Error("tts emitted no audio");
      }
      metrics?.mark("tts.first_audio"); // first-wins — later sentences are ignored
      if (pacer) {
        // Approximation: decoded base64 bytes / 2 ≈ PCM16 sample count.
        // Same formula for "wav" (header inflates the estimate slightly).
        await pacer.pace(base64SampleCount(captured.dataBase64));
      }
      // pacer contract: reset() does not cancel in-flight sleeps — re-check
      // the abort signal after awaiting before emitting.
      if (turn.interrupted || (!force && turn.controller.signal.aborted)) {
        return;
      }
      onEvent({
        type: "speech.audio",
        text: sentence,
        audio: { encoding: captured.encoding, dataBase64: captured.dataBase64 }
      });
      ctx.spoken = true;
    } catch (error) {
      if (turn.interrupted || (!force && turn.controller.signal.aborted)) {
        return; // aborted synthesis is not an error
      }
      emitError("tts", error);
    }
  };

  const speakSentences = async (turn, ctx, sentences) => {
    for (const sentence of sentences) {
      if (turn.interrupted || turn.controller.signal.aborted || ctx.guardTripped) {
        return;
      }
      if (!sentence.trim()) {
        continue; // whitespace-only (Markdown "\n" noise) — never reaches tts
      }
      ctx.produced = true;
      if (ctx.sentenceCount >= maxSentences) {
        ctx.guardTripped = true;
        turn.controller.abort();
        onEvent({
          type: "error",
          stage: "guard",
          message: `sentence cap reached (maxSentences=${maxSentences})`
        });
        return;
      }
      ctx.sentenceCount += 1;
      await speak(turn, ctx, sentence);
    }
  };

  const consumeStream = async (turn, ctx, stream) => {
    const splitter = createSentenceSplitter();
    const iterator = stream[Symbol.asyncIterator]();
    let finished = false;
    try {
      while (true) {
        // Inactivity timeout: time only the wait for the NEXT delta — tts and
        // pacing time below must never count against the brain.
        const { value: chunk, done } = await withTimeout(
          iterator.next(),
          timeouts.brain,
          "brain"
        );
        if (done) {
          finished = true;
          break;
        }
        if (turn.interrupted || turn.controller.signal.aborted) break;
        const delta = typeof chunk?.delta === "string" ? chunk.delta : "";
        ctx.fullText += delta;
        const sentences = splitter.push(delta);
        if (sentences.some((sentence) => sentence.trim())) {
          metrics?.mark("llm.first_sentence"); // first-wins; whitespace-only never marks
        }
        await speakSentences(turn, ctx, sentences);
        if (turn.interrupted || turn.controller.signal.aborted || ctx.guardTripped) break;
      }
    } finally {
      if (!finished) {
        // Best-effort generator cleanup — never awaited: a brain suspended on
        // a pending await would block return() until that await settles.
        try {
          iterator.return?.()?.catch?.(() => {});
        } catch {
          // ignore — cleanup only
        }
      }
    }
    if (!turn.interrupted && !turn.controller.signal.aborted && !ctx.guardTripped) {
      await speakSentences(turn, ctx, splitter.flush());
    }
  };

  const runTurn = async (turn, endEvent) => {
    // 1. STT — already done by the detector: speech.end carries the final
    //    text (streaming STT result, or the wrapped batch transcription).
    const transcript = typeof endEvent.text === "string" ? endEvent.text : "";
    metrics?.mark("stt.final"); // first-wins: the wrapped detector marked earlier
    if (!transcript.trim()) {
      onEvent({ type: "stt.empty" });
      return;
    }

    // 2. Quick responder — never paced. Dynamic responders (fireFor) generate
    //    a context-appropriate ack via a separate bounded LLM call (their own
    //    ≤1.5s deadline) and are AWAITED before the brain stream opens —
    //    mirrors AIAvatarKit's ordering. Static responders (fire) stay
    //    zero-latency.
    let quick = null;
    if (quickResponder) {
      if (typeof quickResponder.fireFor === "function") {
        quick = await quickResponder.fireFor(transcript, {
          signal: turn.controller.signal
        });
        if (turn.interrupted) return; // interrupted during fireFor — bail
      } else {
        quick = quickResponder.fire() ?? null;
      }
    }
    if (quick) {
      onEvent({
        type: "speech.audio",
        text: quick.text,
        audio: { encoding: quick.encoding, dataBase64: quick.audio },
        quick: true
      });
    }

    // 3. Brain stream through the harness gate sequence. The ack text flows
    //    onward as quickText (additive second arg — single-arg buildInput
    //    callbacks keep working) so the session handler can append the
    //    continuation instruction ("already said X, continue from there").
    //    Static acks flow too: the continuation instruction is just as valid
    //    for a pre-synthesized "うん。".
    let opened;
    try {
      opened = await harness.receiveStream(buildInput(transcript, { quickText: quick?.text ?? null }), {
        signal: turn.controller.signal
      });
    } catch (error) {
      if (!turn.interrupted) emitError("brain", error);
      return;
    }
    if (turn.interrupted) {
      opened?.abandon?.(); // interrupt fired before abandon was attachable
      return;
    }
    if (!opened?.stream) {
      onEvent({ type: "turn.rejected", result: opened?.result ?? null });
      return;
    }
    turn.abandon = opened.abandon;

    // 4–7. Consume deltas → sentences → tts, guarded by the brain
    // inactivity timeout (per-delta, inside consumeStream).
    const ctx = {
      fullText: "",
      sentenceCount: 0,
      produced: false, // a non-whitespace sentence came out of the splitter
      spoken: false,
      guardTripped: false
    };
    let brainFailure = null;
    try {
      await consumeStream(turn, ctx, opened.stream);
    } catch (error) {
      if (turn.interrupted) return;
      brainFailure = message(error);
      turn.controller.abort(); // stop the brain (and any orphaned consumption)
    }
    if (turn.interrupted) return;

    if (!brainFailure && !ctx.produced) {
      brainFailure = "empty response"; // zero-delta turn (e.g. Codex {delta:"", final:true})
    }
    if (brainFailure) {
      // Whatever was already spoken stays spoken; apologize and close the turn.
      await speak(turn, ctx, fallbackPhrase, { force: true });
      if (turn.interrupted) return;
      onEvent({ type: "error", stage: "brain", message: brainFailure });
    }

    try {
      await opened.finalize(ctx.fullText);
    } catch (error) {
      emitError("finalize", error);
    }
    if (turn.interrupted) return;

    metrics?.mark("response.final");
    onEvent({
      type: "turn.final",
      text: ctx.fullText,
      metrics: metrics?.snapshot() ?? null
    });
    pacer?.reset();
    metrics?.reset();
  };

  const startTurn = (endEvent) => {
    const turn = {
      controller: new AbortController(),
      abandon: null,
      interrupted: false
    };
    active = turn;
    state = "speaking";
    turnCount += 1;
    runTurn(turn, endEvent)
      .catch((error) => emitError("pipeline", error))
      .finally(() => {
        if (active === turn) {
          active = null;
          state = "idle";
        }
      });
  };

  const interrupt = (reason = "interrupted") => {
    const turn = active;
    if (!turn) return; // idle — safe no-op
    active = null;
    turn.interrupted = true;
    turn.controller.abort(); // stop brain + tts — abandon alone keeps burning tokens
    if (typeof turn.abandon === "function") {
      turn.abandon(); // latched: double calls are no-ops
    }
    onEvent({ type: "speech.interrupted", reason });
    pacer?.reset();
    state = "idle";
    // detector.reset() deliberately NOT called — the mic keeps running.
  };

  // Single sink for one detector event — fed by BOTH delivery channels:
  //   - the push() return array (pull mode / wrapVadSttDetector), and
  //   - the detector's onEvent callback (azure-stream push mode: late events
  //     surface here without a mic frame; see handleDetectorEvent wiring).
  // The detector's exactly-once contract guarantees an event arrives through
  // ONE channel, so this never double-handles a turn.
  const handleDetectorEvent = (event) => {
    if (!event) return;
    if (event.type === "speech.start") {
      if (active) interrupt("barge-in"); // auto barge-in: same path as interrupt()
      // New-utterance boundary: wipe stale first-wins marks left by
      // interrupted / early-exit turns (stt.empty, rejection, errors)
      // BEFORE marking. Not inside interrupt() — that would wipe the new
      // utterance's own speech.start on barge-in.
      metrics?.reset();
      metrics?.mark("speech.start");
      state = "listening";
    } else if (event.type === "transcript.partial") {
      quickResponder?.createGenerationTask?.(event.text ?? "");
      onEvent({ type: "stt.partial", text: event.text ?? "" });
    } else if (event.type === "speech.end") {
      metrics?.mark("speech.end");
      if (active) interrupt("new-utterance"); // serialize: new utterance wins
      startTurn(event);
    }
  };

  const pushAudio = async (int16Frame) => {
    try {
      // In onEvent (push) mode push() returns [] — events already went through
      // handleDetectorEvent via the callback. In pull mode the return array
      // carries them. Either way each event is handled exactly once.
      const events = await speechDetector.push(int16Frame);
      for (const event of events ?? []) {
        handleDetectorEvent(event);
      }
    } catch (error) {
      // wrapVadSttDetector tags batch-STT failures with stage "stt";
      // everything else is the input front-end ("vad").
      emitError(error?.stage ?? "vad", error);
    }
  };

  const snapshot = () => ({ state, turnCount });

  return Object.freeze({ pushAudio, interrupt, snapshot, handleDetectorEvent });
};
