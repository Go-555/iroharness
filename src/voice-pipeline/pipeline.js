// Streaming voice pipeline orchestrator.
//
// createVoicePipeline({ vad, stt, harness, tts, pacer = null, quickResponder = null,
//                       metrics = null, voice = "iroha", buildInput, maxSentences = 30,
//                       sampleRate = 16000,
//                       stageTimeoutMs = { stt: 10000, brain: 30000, tts: 10000 },
//                       fallbackPhrase = "少々調子が悪いや。", onEvent = () => {} })
//   → frozen { pushAudio(int16Frame), interrupt(reason), snapshot() }
//
// Composes: silero-vad → stt adapter → harness.receiveStream (brain stream) →
// sentence-splitter → tts adapter, with optional pacer / quick-responder / metrics.
//
// Flow per utterance ("the turn", runs in the background so the mic loop keeps
// feeding pushAudio — that is what makes auto barge-in possible):
//   1. vad speech.end → STT (timeout stageTimeoutMs.stt). Empty text → stt.empty, stop.
//   2. quickResponder?.fire() → emitted immediately (quick: true), never paced.
//   3. harness.receiveStream(buildInput(text), { signal }). Gate-rejected
//      ({ stream: null, result }) → turn.rejected, stop.
//   4. Stream deltas → sentence splitter → per closed sentence: tts.stream
//      (timeout stageTimeoutMs.tts) → optional pacer.pace → onEvent speech.audio.
//      Whitespace-only sentences are skipped (Markdown "\n" noise). maxSentences
//      caps runaway turns (abort + one error stage:"guard").
//   5. One sentence's tts failure → error stage:"tts", next sentence continues.
//   6. Brain death / timeout / zero speakable sentences → fallbackPhrase via tts
//      (best effort), error stage:"brain", finalize with partial text.
//   7. finalize(fullText) → turn.final { text, metrics } → pacer/metrics reset.
//
// barge-in (interrupt() or vad speech.start while a turn runs) fires BOTH the
// per-turn AbortSignal and the latched abandon() — abandon alone only resets
// harness state; without the signal the brain keeps burning tokens.
//
// buildInput(transcript) is REQUIRED: the session handler owns platform
// specifics (source/actor/metadata) — the pipeline never hardcodes them.
//
// Pacing approximation: sampleCount = decoded base64 byte length / 2 (PCM16).
// For "wav" payloads the same approximation is used — the header bytes inflate
// the estimate by <1% on real utterances, which only makes pacing slightly
// more conservative (never starves the device).
//
// Errors never escape pushAudio — every failure is normalized to
// onEvent({ type: "error", stage, message }).

import { Buffer } from "node:buffer";

import { createSentenceSplitter } from "./sentence-splitter.js";

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

const int16ToBase64 = (int16) =>
  Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength).toString("base64");

const base64SampleCount = (dataBase64) =>
  Math.floor(Buffer.from(dataBase64, "base64").length / 2);

const toArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

export const createVoicePipeline = ({
  vad,
  stt,
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
  if (!vad || typeof vad.push !== "function") {
    throw new Error("createVoicePipeline requires vad with push(int16Frame)");
  }
  if (!stt || typeof stt.start !== "function") {
    throw new Error("createVoicePipeline requires stt with start({ onEvent })");
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

  let state = "idle"; // "idle" | "listening" | "speaking"
  let turnCount = 0;
  let active = null; // { controller, abandon, interrupted }

  const emitError = (stage, error) => {
    onEvent({ type: "error", stage, message: message(error) });
  };

  // STT one-shot: mirrors the realtime session handler / slack example —
  // collect events from both onEvent and the returned arrays, then take the
  // last "stt.final" carrying text.
  const transcribe = async (audio) => {
    const events = [];
    const session = stt.start({ onEvent: (event) => events.push(event) });
    const pushed = await session.push({
      audio: {
        encoding: "pcm_s16le",
        sampleRate,
        dataBase64: int16ToBase64(audio)
      },
      final: false
    });
    const finals = await session.end();
    const all = [...events, ...toArray(pushed), ...toArray(finals)];
    const finalEvent = all
      .reverse()
      .find((event) => event?.type === "stt.final" && event.text);
    return finalEvent?.text ?? "";
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
    for await (const chunk of stream) {
      if (turn.interrupted || turn.controller.signal.aborted) break;
      const delta = typeof chunk?.delta === "string" ? chunk.delta : "";
      ctx.fullText += delta;
      const sentences = splitter.push(delta);
      if (sentences.length > 0) {
        metrics?.mark("llm.first_sentence"); // first-wins
      }
      await speakSentences(turn, ctx, sentences);
      if (turn.interrupted || turn.controller.signal.aborted || ctx.guardTripped) break;
    }
    if (!turn.interrupted && !turn.controller.signal.aborted && !ctx.guardTripped) {
      await speakSentences(turn, ctx, splitter.flush());
    }
  };

  const runTurn = async (turn, audio) => {
    // 1. STT
    let transcript;
    try {
      transcript = await withTimeout(transcribe(audio), timeouts.stt, "stt");
    } catch (error) {
      if (!turn.interrupted) emitError("stt", error);
      return;
    }
    if (turn.interrupted) return;
    metrics?.mark("stt.final");
    if (!transcript || !transcript.trim()) {
      onEvent({ type: "stt.empty" });
      return;
    }

    // 2. Quick responder — tiny pre-synthesized filler, never paced.
    const quick = quickResponder?.fire() ?? null;
    if (quick) {
      onEvent({
        type: "speech.audio",
        text: quick.text,
        audio: { encoding: quick.encoding, dataBase64: quick.audio },
        quick: true
      });
    }

    // 3. Brain stream through the harness gate sequence.
    let opened;
    try {
      opened = await harness.receiveStream(buildInput(transcript), {
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

    // 4–7. Consume deltas → sentences → tts, guarded by the brain timeout.
    const ctx = {
      fullText: "",
      sentenceCount: 0,
      produced: false, // a non-whitespace sentence came out of the splitter
      spoken: false,
      guardTripped: false
    };
    let brainFailure = null;
    try {
      await withTimeout(consumeStream(turn, ctx, opened.stream), timeouts.brain, "brain");
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

  const startTurn = (audio) => {
    const turn = {
      controller: new AbortController(),
      abandon: null,
      interrupted: false
    };
    active = turn;
    state = "speaking";
    turnCount += 1;
    runTurn(turn, audio)
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
    // vad.reset() deliberately NOT called — the mic keeps running.
  };

  const pushAudio = async (int16Frame) => {
    try {
      const events = await vad.push(int16Frame);
      for (const event of events ?? []) {
        if (event.type === "speech.start") {
          metrics?.mark("speech.start");
          if (active) interrupt("barge-in"); // auto barge-in: same path as interrupt()
          state = "listening";
        } else if (event.type === "speech.end") {
          metrics?.mark("speech.end");
          if (active) interrupt("new-utterance"); // serialize: new utterance wins
          startTurn(event.audio);
        }
      }
    } catch (error) {
      emitError("vad", error);
    }
  };

  const snapshot = () => ({ state, turnCount });

  return Object.freeze({ pushAudio, interrupt, snapshot });
};
