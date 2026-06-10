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
