// Pre-synthesized quick-responder.
//
// createQuickResponder({ tts, phrases = ["うん。"] }) → frozen { warmup(), fire() }
//
// warmup() → Promise<number>
//   Synthesizes each uncached phrase via tts.stream, caching the FIRST
//   tts.audio event per phrase. Best-effort — failures are silently skipped.
//   Idempotent: already-cached phrases are not re-synthesized.
//   Resolves to the number of phrases cached.
//
// fire() → { text, audio, encoding } | null
//   Synchronously returns the next cached entry round-robin, or null if
//   nothing is cached yet. Zero-latency — never synthesizes, never awaits.
//
// ---------------------------------------------------------------------------
//
// Dynamic quick-responder (AIAvatarKit QuickResponder parity).
//
// createDynamicQuickResponder({ brain, tts, fallback = null, timeoutMs = 1500,
//                               maxChars = 20, promptPrefix = <JA default>,
//                               voice = "iroha" })
//   → frozen { warmup(), fireFor(transcript, { signal }) }
//
// fireFor(transcript, { signal }) → Promise<
//   { text, audio, encoding, dynamic: true } | <fallback.fire() result> | null>
//   A SEPARATE lightweight brain call generates a context-appropriate opening
//   phrase (≤10 JA chars by prompt; maxChars is the hard collection budget),
//   then synthesizes it via tts.stream (FIRST tts.audio event) — all bounded
//   by ONE timeoutMs deadline. On timeout / brain error / empty text / abort /
//   missing audio → fallback?.fire?.() ?? null (the static responder is the
//   fallback; its result carries no `dynamic` flag).
//
//   Brain context shape: { input: { text: promptPrefix + "\n\n" + transcript } }
//   — the minimal common shape both createOpenAiResponsesBrain and
//   createCodexAppServerBrain read (context.input?.text; everything else is
//   optional in their prompt builders).
//
// warmup() → Promise<number>
//   Passthrough to fallback.warmup() when present (so callers treat static and
//   dynamic responders uniformly); resolves 0 without a fallback.

import { toBrainStream } from "./brain-stream.js";

// 本家 quick_responder/base.py の日本語プロンプト準拠。
export const DEFAULT_QUICK_PROMPT_PREFIX =
  "$以下はユーザーの発話内容である。ユーザー発話を受け止めて、第一声として相応しい、10文字以内のごく短いフレーズを出力せよ。応答の末尾は「。」や「、」句読点や感嘆符とする。フレーズのみを出力すること。";

// Picks the brain for the dynamic quick responder. A dedicated quick brain
// (IROHARNESS_QUICK_BRAIN_PROVIDER) always wins. Falling back to a codex
// voice brain is refused (downgraded: true): codex TTFT loses the 1.5s race
// every turn, its aborted quick turns bleed late events into the main turn,
// and quick prompts pollute the stateful thread.
export const resolveQuickBrain = ({ quickBrain = null, voiceBrain = null, voiceBrainIsCodex = false } = {}) => {
  if (quickBrain) {
    return Object.freeze({ brain: quickBrain, downgraded: false });
  }
  if (voiceBrain && !voiceBrainIsCodex) {
    return Object.freeze({ brain: voiceBrain, downgraded: false });
  }
  return Object.freeze({ brain: null, downgraded: true });
};

export const createQuickResponder = ({ tts, phrases = ["うん。"] } = {}) => {
  if (!tts || typeof tts.stream !== "function") {
    throw new Error("createQuickResponder requires tts with a stream function");
  }

  // Map<phrase string, { text, audio, encoding }> — preserves insertion order
  const cache = new Map();
  let roundRobinIndex = 0;

  const warmup = async () => {
    const uncached = phrases.filter((p) => !cache.has(p));

    await Promise.allSettled(
      uncached.map((phrase) =>
        new Promise((resolve) => {
          let captured = null;

          tts
            .stream({
              text: phrase,
              onEvent(event) {
                // Capture only the FIRST tts.audio event
                if (captured === null && event.type === "tts.audio") {
                  captured = {
                    text: phrase,
                    audio: event.audio,
                    encoding: event.encoding ?? "wav",
                  };
                }
              },
            })
            .then(() => {
              if (captured !== null) {
                cache.set(phrase, captured);
              }
              resolve();
            })
            .catch(() => {
              // Best-effort: skip phrases that fail to synthesize
              resolve();
            });
        }),
      ),
    );

    return cache.size;
  };

  const fire = () => {
    if (cache.size === 0) return null;

    const entries = [...cache.values()];
    const entry = entries[roundRobinIndex % entries.length];
    roundRobinIndex = (roundRobinIndex + 1) % entries.length;
    return entry;
  };

  return Object.freeze({ warmup, fire });
};

export const createDynamicQuickResponder = ({
  brain,
  tts,
  fallback = null,
  timeoutMs = 1500,
  maxChars = 20,
  promptPrefix = DEFAULT_QUICK_PROMPT_PREFIX,
  voice = "iroha"
} = {}) => {
  if (
    !brain ||
    (typeof brain.respondStream !== "function" && typeof brain.respond !== "function")
  ) {
    throw new Error("createDynamicQuickResponder requires brain with respondStream() or respond()");
  }
  if (!tts || typeof tts.stream !== "function") {
    throw new Error("createDynamicQuickResponder requires tts with a stream function");
  }

  // Generate the opening phrase then synthesize it — the caller races this
  // against the deadline. `signal` combines the caller's abort with the
  // deadline so the underlying brain request / tts call gets cancelled too.
  const generate = async (transcript, signal) => {
    const context = { input: { text: `${promptPrefix}\n\n${transcript}` } };
    const stream = toBrainStream(brain, context, { signal });
    let collected = "";
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      collected += typeof chunk?.delta === "string" ? chunk.delta : "";
      if (collected.length >= maxChars) break; // budget hit — stop iterating
    }
    // (breaking a for-await closes the generator via iterator.return())
    if (signal?.aborted) {
      throw new Error("dynamic quick response aborted");
    }
    const text = collected.trim().slice(0, maxChars);
    if (!text) {
      throw new Error("dynamic quick response was empty");
    }

    let captured = null;
    await tts.stream({
      text,
      voice,
      signal,
      onEvent: (event) => {
        if (captured === null && event.type === "tts.audio") {
          captured = { audio: event.audio, encoding: event.encoding ?? "wav" };
        }
      }
    });
    if (signal?.aborted) {
      throw new Error("dynamic quick response aborted");
    }
    if (!captured) {
      throw new Error("dynamic quick response tts emitted no audio");
    }
    return Object.freeze({
      text,
      audio: captured.audio,
      encoding: captured.encoding,
      dynamic: true
    });
  };

  const fireFor = async (transcript, { signal } = {}) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }
    let timer = null;
    try {
      // Promise.race subscribes to BOTH promises, so a late rejection from the
      // losing generate() is still observed — no unhandled rejection.
      return await Promise.race([
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(); // best-effort: cancel the orphaned brain/tts work
            reject(new Error(`dynamic quick response timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
        generate(transcript, controller.signal)
      ]);
    } catch {
      return fallback?.fire?.() ?? null;
    } finally {
      clearTimeout(timer); // no orphaned timers (Task 8 lesson)
      signal?.removeEventListener("abort", onAbort);
    }
  };

  // Passthrough so callers can treat static and dynamic responders uniformly.
  const warmup = async () => (fallback?.warmup ? fallback.warmup() : 0);

  return Object.freeze({ warmup, fireFor });
};
