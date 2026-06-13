// Speech detector contract + implementations.
//
// A "speech detector" owns BOTH voice-activity detection and transcription,
// so the pipeline only deals in one event stream:
//
//   detector.push(int16Frame) → Promise<events[]>
//     { type: "speech.start" }                    — an utterance began
//     { type: "transcript.partial", text }        — interim transcription
//     { type: "speech.end", text?, audio?, fallback? } — utterance closed;
//       `text` is the final transcription when the detector produced one
//       (streaming STT, or the wrapped batch STT); `audio` is the captured
//       Int16Array when the detector buffers audio (silero wrap only);
//       `fallback: true` marks a degraded final (gated finalize timeout
//       fired before the recognizer delivered its text)
//   detector.reset()                              — drop utterance state
//   async detector.close()                        — release connections
//
// Event delivery contract — TWO interchangeable styles, exactly-once either way:
//   pull (default, onEvent = null): SDK callbacks queue events internally and
//     push() DRAINS the queue and returns it. Events caused by asynchronous
//     recognizer callbacks surface on the NEXT push() (in steady-state mic
//     streaming that is one frame ≈ 32 ms later).
//   push (onEvent set): the detector calls onEvent(event) the MOMENT each
//     event is produced (push() always returns [] in this mode). This is the
//     fix for the real-hardware case where the mic stops sending frames once
//     the server starts speaking (or PTT release): a late speech.end / final
//     recognized result has no following push() to drain it, so without
//     onEvent it would be stranded in the queue forever.
//   Single source of truth: the internal queue. Every event is delivered
//   EITHER via onEvent (if set) OR via the push() return value (if null) —
//   never both, never zero.
//   createAzureStreamDetector accepts `onEvent` (the host wires it to the
//   pipeline's handleDetectorEvent); wrapVadSttDetector is
//   synchronous-on-speech.end with no late events, so it has no onEvent option.
//
// push() must be awaited serially (one mic loop) — same rule as silero-vad.
//
// Two implementations:
//
// wrapVadSttDetector({ vad, stt, sampleRate = 16000, timeoutMs = 10000,
//                      metrics = null })
//   Adapts the existing silero-vad + batch-STT pair to the detector
//   contract: vad speech.end → run the batch STT inside push() → emit
//   speech.end with the text (this is the transcribe logic that used to
//   live in pipeline.js). Because the STT runs inside push(), the mic loop
//   blocks for the STT duration — pass `metrics` (a createVoiceTurnMetrics
//   instance) so "speech.end" is marked when the vad closes and "stt.final"
//   when the text lands; the pipeline's own (later) marks are first-wins
//   no-ops, keeping stt_ms / first_audio_total_ms truthful. STT failures
//   reject push() with error.stage = "stt" so the pipeline can keep its
//   legacy error stage.
//
// createAzureStreamDetector({ subscriptionKey, region, language = "ja-JP",
//                             segmentationSilenceMs = 500, sampleRate = 16000,
//                             mode = "gated", gate = null, prerollFrames = 10,
//                             finalizeTimeoutMs = 2000, sdk = null,
//                             importSdk = null, onEvent = null })
//   True streaming STT on the Azure Speech SDK (PushAudioInputStream +
//   continuous recognition), mirroring AIAvatarKit's AzureStreamSpeechDetector.
//   `microsoft-cognitiveservices-speech-sdk` is an optionalDependency,
//   lazily imported on the first push (inject `sdk` in tests; `importSdk`
//   overrides the import for error-path tests — same pattern as
//   loadSileroSession). recognizing → transcript.partial, recognized
//   (RecognizedSpeech, non-empty) → speech.end { text }. canceled /
//   sessionStopped drop the session; the next push reconnects.
//
//   mode "continuous": every frame goes to Azure for the connection's
//     lifetime (本家同等). speech.start fires on the FIRST recognizing of an
//     utterance. Billing: the whole mic-open time is metered — the device's
//     mic on/off is the wallet switch.
//
//   mode "gated" (default): requires `gate`, a silero vad instance
//     (createSileroVad) fed every frame. While idle, frames only fill a
//     pre-roll ring (prerollFrames). Gate speech.start → open a fresh
//     per-utterance Azure session, flush the ring, then stream live frames;
//     detector speech.start fires here (the gate is the authority). Gate
//     speech.end → stop streaming and close the utterance's input; the
//     final text ordering is handled either way:
//       - recognized already delivered the full text (no recognizing after
//         it) → emit speech.end with it immediately;
//       - otherwise wait for recognized (or canceled/sessionStopped) up to
//         finalizeTimeoutMs, then fall back to the accumulated final+partial
//         text — or no text at all. Exactly one speech.end per utterance.
//     Billing: only speech segments (+ pre-roll) are metered.
//
//     Multi-segment caveat: with the default tuning (Azure segmentation
//     500 ms < gate silence 650 ms) Azure finalizes each segment before the
//     gate closes, so multi-sentence utterances accumulate every recognized
//     text and join them for the final speech.end.

import { Buffer } from "node:buffer";

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
      },
    );
  });

const int16ToBase64 = (int16) =>
  Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength).toString(
    "base64",
  );

const toArray = (value) =>
  Array.isArray(value) ? value : value ? [value] : [];

export const wrapVadSttDetector = ({
  vad,
  stt,
  sampleRate = 16000,
  timeoutMs = 10000,
  metrics = null,
} = {}) => {
  if (!vad || typeof vad.push !== "function") {
    throw new Error("wrapVadSttDetector requires vad with push(int16Frame)");
  }
  if (!stt || typeof stt.start !== "function") {
    throw new Error("wrapVadSttDetector requires stt with start({ onEvent })");
  }

  // Batch STT one-shot (moved here from pipeline.js): collect events from
  // both onEvent and the returned arrays, then take the last "stt.final"
  // carrying text.
  const transcribe = async (audio) => {
    const events = [];
    const session = stt.start({ onEvent: (event) => events.push(event) });
    const pushed = await session.push({
      audio: {
        encoding: "pcm_s16le",
        sampleRate,
        dataBase64: int16ToBase64(audio),
      },
      final: false,
    });
    const finals = await session.end();
    const all = [...events, ...toArray(pushed), ...toArray(finals)];
    const finalEvent = all
      .reverse()
      .find((event) => event?.type === "stt.final" && event.text);
    return finalEvent?.text ?? "";
  };

  const push = async (int16Frame) => {
    const vadEvents = await vad.push(int16Frame);
    const events = [];
    for (const event of vadEvents ?? []) {
      if (event.type === "speech.start") {
        events.push({ type: "speech.start" });
      } else if (event.type === "speech.end") {
        metrics?.mark("speech.end"); // BEFORE the batch STT — keeps stt_ms honest
        let text;
        try {
          text = await withTimeout(transcribe(event.audio), timeoutMs, "stt");
        } catch (error) {
          error.stage = "stt";
          throw error;
        }
        metrics?.mark("stt.final");
        events.push({ type: "speech.end", text, audio: event.audio });
      }
    }
    return events;
  };

  const reset = () => {
    vad.reset?.();
  };

  const close = async () => {};

  return Object.freeze({ push, reset, close });
};

export const createAzureStreamDetector = ({
  subscriptionKey,
  region,
  language = "ja-JP",
  segmentationSilenceMs = 500,
  sampleRate = 16000,
  mode = "gated",
  gate = null,
  prerollFrames = 10,
  finalizeTimeoutMs = 2000,
  sdk = null,
  importSdk = null,
  onEvent = null,
} = {}) => {
  if (onEvent != null && typeof onEvent !== "function") {
    throw new Error("createAzureStreamDetector: onEvent must be a function");
  }
  if (!subscriptionKey) {
    throw new Error("createAzureStreamDetector requires subscriptionKey");
  }
  if (!region) {
    throw new Error("createAzureStreamDetector requires region");
  }
  if (mode !== "gated" && mode !== "continuous") {
    throw new Error(
      `createAzureStreamDetector: unknown mode "${mode}" (use "gated" or "continuous")`,
    );
  }
  if (mode === "gated" && (!gate || typeof gate.push !== "function")) {
    throw new Error(
      'createAzureStreamDetector mode "gated" requires gate (a silero vad instance with push(int16Frame))',
    );
  }

  let sdkPromise = null;
  const loadSdk = () => {
    sdkPromise ??= (async () => {
      if (sdk) return sdk;
      try {
        const doImport =
          importSdk ?? (() => import("microsoft-cognitiveservices-speech-sdk"));
        const mod = await doImport("microsoft-cognitiveservices-speech-sdk");
        return mod.default ?? mod;
      } catch (cause) {
        sdkPromise = null; // allow a retry after the package gets installed
        throw new Error(
          "microsoft-cognitiveservices-speech-sdk is not available. Install it with " +
            "`npm install microsoft-cognitiveservices-speech-sdk` to use the " +
            "azure-stream speech detector.",
          { cause },
        );
      }
    })();
    return sdkPromise;
  };

  // Event queue is the single source of truth. SDK callbacks (and the gate
  // logic) enqueue via emit(); delivery is exactly-once through one channel:
  //   - onEvent set  → flush() drains and calls onEvent for each, returns [].
  //   - onEvent null → flush() is a no-op; push() drains via drain() instead.
  // emit() flushes immediately so push-style callers see late events the
  // moment an SDK callback fires, with no following push() to drain them.
  const queue = [];
  const drain = () => queue.splice(0, queue.length);
  const flush = () => {
    if (!onEvent) return; // pull mode: events wait in the queue for push()
    for (const event of queue.splice(0, queue.length)) onEvent(event);
  };
  const emit = (event) => {
    queue.push(event);
    flush();
  };

  let session = null; // { speech, pushStream, recognizer, dead }
  let connecting = null;

  // Utterance state
  let utteranceStarted = false; // detector speech.start emitted
  let lastPartial = ""; // newest recognizing text
  let finalParts = []; // recognized texts accumulated this utterance
  let partialSinceFinal = false; // recognizing arrived after the last recognized
  let awaitingFinal = false; // gated: gate closed, waiting on recognized
  let finalizeTimer = null;

  // Gated-mode state
  let gateOpen = false;
  let preroll = []; // ring of the last prerollFrames frames while idle

  const resetUtterance = () => {
    utteranceStarted = false;
    lastPartial = "";
    finalParts = [];
    partialSinceFinal = false;
  };

  const clearFinalizeTimer = () => {
    if (finalizeTimer) {
      clearTimeout(finalizeTimer);
      finalizeTimer = null;
    }
  };

  const teardownSession = () => {
    const current = session;
    session = null;
    connecting = null;
    if (!current) return;
    current.dead = true;
    try {
      current.pushStream?.close?.();
    } catch {
      // releasing only
    }
    try {
      current.recognizer?.stopContinuousRecognitionAsync?.(
        () => {
          try {
            current.recognizer?.close?.();
          } catch {
            // releasing only
          }
        },
        () => {
          try {
            current.recognizer?.close?.();
          } catch {
            // releasing only
          }
        },
      );
    } catch {
      // releasing only
    }
  };

  const writeFrame = (int16Frame) => {
    const stream = session?.pushStream;
    if (!stream) return;
    try {
      // Always hand the SDK its own copy — pre-roll frames and caller
      // buffers must never be aliased into the SDK's internal ring.
      stream.write(
        int16Frame.buffer.slice(
          int16Frame.byteOffset,
          int16Frame.byteOffset + int16Frame.byteLength,
        ),
      );
    } catch {
      // a torn-down stream mid-write — the canceled handler reconnects
    }
  };

  // Close the current (gated) utterance with the best text we have. Exactly
  // one speech.end per utterance: callers guard on awaitingFinal/gateOpen.
  // `fallback: true` marks a degraded final (the finalize timeout fired
  // before recognized arrived) so hosts can count them in logs.
  const finishGatedUtterance = ({ fallback = false } = {}) => {
    clearFinalizeTimer();
    const text = finalParts.join("") + (partialSinceFinal ? lastPartial : "");
    const event = { type: "speech.end" };
    if (text) event.text = text;
    if (fallback) event.fallback = true;
    emit(event);
    awaitingFinal = false;
    resetUtterance();
    teardownSession(); // per-utterance session: billing only for speech
  };

  const onRecognizing = (current, eventArgs) => {
    if (current.dead) return;
    const text = eventArgs?.result?.text ?? "";
    if (mode === "continuous" && !utteranceStarted) {
      utteranceStarted = true;
      emit({ type: "speech.start" });
    }
    if (!text) return;
    lastPartial = text;
    partialSinceFinal = true;
    emit({ type: "transcript.partial", text });
  };

  const onRecognized = (current, eventArgs) => {
    if (current.dead) return;
    const reason = eventArgs?.result?.reason;
    const isSpeech = reason === current.speech.ResultReason?.RecognizedSpeech;
    const text = isSpeech ? (eventArgs?.result?.text ?? "") : "";
    if (mode === "continuous") {
      if (text) {
        if (!utteranceStarted) emit({ type: "speech.start" }); // recognized without a prior recognizing
        emit({ type: "speech.end", text });
      } else if (utteranceStarted) {
        emit({ type: "speech.end" }); // NoMatch / empty — closes as stt.empty downstream
      }
      resetUtterance();
      return;
    }
    // gated
    if (text) {
      finalParts.push(text);
      partialSinceFinal = false;
      lastPartial = "";
    }
    if (awaitingFinal) {
      finishGatedUtterance();
    }
    // gate still open: hold the text — gate speech.end decides when to emit
  };

  // canceled / sessionStopped: the recognizer is gone. Finalize any open
  // utterance with what we have, drop the session, reconnect on next push.
  const onDropped = (current) => {
    if (current.dead || current !== session) return;
    if (mode === "gated") {
      if (awaitingFinal) {
        finishGatedUtterance(); // tears the session down too
        return;
      }
      if (gateOpen) {
        gateOpen = false;
        const text =
          finalParts.join("") + (partialSinceFinal ? lastPartial : "");
        const event = { type: "speech.end" };
        if (text) event.text = text;
        emit(event);
        resetUtterance();
      }
    } else {
      if (utteranceStarted && lastPartial) {
        emit({ type: "speech.end", text: lastPartial });
      } else if (utteranceStarted) {
        emit({ type: "speech.end" });
      }
      resetUtterance();
    }
    teardownSession();
  };

  const openSession = async () => {
    const speech = await loadSdk();
    const speechConfig = speech.SpeechConfig.fromSubscription(
      subscriptionKey,
      region,
    );
    speechConfig.speechRecognitionLanguage = language;
    speechConfig.setProperty(
      speech.PropertyId.Speech_SegmentationSilenceTimeoutMs,
      String(segmentationSilenceMs),
    );
    const format = speech.AudioStreamFormat.getWaveFormatPCM(sampleRate, 16, 1);
    const pushStream = speech.AudioInputStream.createPushStream(format);
    const audioConfig = speech.AudioConfig.fromStreamInput(pushStream);
    const recognizer = new speech.SpeechRecognizer(speechConfig, audioConfig);
    const current = { speech, pushStream, recognizer, dead: false };
    recognizer.recognizing = (_sender, eventArgs) =>
      onRecognizing(current, eventArgs);
    recognizer.recognized = (_sender, eventArgs) =>
      onRecognized(current, eventArgs);
    recognizer.canceled = () => onDropped(current);
    recognizer.sessionStopped = () => onDropped(current);
    await new Promise((resolveStart, rejectStart) => {
      recognizer.startContinuousRecognitionAsync(resolveStart, (error) =>
        rejectStart(new Error(String(error))),
      );
    });
    return current;
  };

  const ensureSession = async () => {
    if (session) return session;
    connecting ??= openSession().then(
      (created) => {
        connecting = null;
        session = created;
        return created;
      },
      (error) => {
        connecting = null;
        error.stage ??= "stt";
        throw error;
      },
    );
    return connecting;
  };

  const pushContinuous = async (int16Frame) => {
    await ensureSession(); // reconnect-on-next-push after canceled/sessionStopped
    writeFrame(int16Frame);
    return drain();
  };

  const pushGated = async (int16Frame) => {
    const frame = int16Frame.slice(); // ring frames outlive the caller's buffer
    const gateEvents = await gate.push(frame);
    let sawStart = false;
    let sawEnd = false;
    for (const event of gateEvents ?? []) {
      if (event.type === "speech.start") sawStart = true;
      else if (event.type === "speech.end") sawEnd = true;
    }

    if (sawStart && !gateOpen) {
      // Re-trigger during the awaitingFinal window: force-finish the dying
      // utterance (its speech.end with accumulated text emits ahead of this
      // utterance's speech.start) so ensureSession opens a FRESH session —
      // the old one's pushStream is already closed and would silently drop
      // this utterance's audio.
      if (awaitingFinal) finishGatedUtterance();
      await ensureSession(); // throws (stage "stt") when the SDK is missing
      gateOpen = true;
      utteranceStarted = true;
      emit({ type: "speech.start" });
      for (const buffered of preroll) writeFrame(buffered);
      preroll = [];
    }

    if (gateOpen) {
      writeFrame(frame);
    } else {
      preroll.push(frame);
      if (preroll.length > prerollFrames) preroll.shift();
    }

    if (sawEnd && gateOpen) {
      gateOpen = false;
      // Stop streaming; closing the input prompts the recognizer to flush
      // its final result for the remaining audio.
      try {
        session?.pushStream?.close?.();
      } catch {
        // already gone — the timeout below still closes the utterance
      }
      if (finalParts.length > 0 && !partialSinceFinal) {
        // recognized already delivered the full text (gate-after-recognized)
        finishGatedUtterance();
      } else {
        // recognized still pending (gate-before-recognized): wait for it,
        // bounded by finalizeTimeoutMs, then fall back to partial text.
        awaitingFinal = true;
        finalizeTimer = setTimeout(() => {
          finalizeTimer = null;
          if (awaitingFinal) finishGatedUtterance({ fallback: true });
        }, finalizeTimeoutMs);
        finalizeTimer.unref?.();
      }
    }

    return drain();
  };

  const push = (int16Frame) =>
    mode === "gated" ? pushGated(int16Frame) : pushContinuous(int16Frame);

  const reset = () => {
    clearFinalizeTimer();
    queue.length = 0;
    preroll = [];
    gateOpen = false;
    awaitingFinal = false;
    resetUtterance();
    gate?.reset?.();
    teardownSession();
  };

  const close = async () => {
    clearFinalizeTimer();
    queue.length = 0;
    preroll = [];
    gateOpen = false;
    awaitingFinal = false;
    resetUtterance();
    const current = session;
    session = null;
    connecting = null;
    if (!current) return;
    current.dead = true;
    try {
      current.pushStream?.close?.();
    } catch {
      // releasing only
    }
    if (
      typeof current.recognizer?.stopContinuousRecognitionAsync === "function"
    ) {
      await new Promise((resolveStop) => {
        try {
          current.recognizer.stopContinuousRecognitionAsync(
            resolveStop,
            resolveStop,
          );
        } catch {
          resolveStop();
        }
      });
    }
    try {
      current.recognizer?.close?.();
    } catch {
      // releasing only
    }
  };

  return Object.freeze({ push, reset, close });
};
