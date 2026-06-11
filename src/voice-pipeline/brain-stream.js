/**
 * brain-stream.js — Streaming brain contract helpers for IroHarness voice pipeline.
 *
 * Contract A — Brain streaming interface (optional method on any brain adapter):
 *   brain.respondStream(context, { signal } = {}) →
 *     AsyncIterable<{ delta: string, emotion?: string, final?: boolean }>
 *   Yields text deltas as the LLM generates. Iteration ends when the response is complete.
 *   The optional second options arg carries an AbortSignal so callers (e.g. barge-in) can
 *   cancel the underlying request even while it is suspended pre-first-byte.
 *
 * Contract B — toBrainStream(brain, context, { signal } = {}):
 *   - If brain.respondStream is a function → return brain.respondStream(context, options).
 *   - Else if brain.respond is a function → return an async generator that awaits respond()
 *     once and yields a single { delta: response.text || "", emotion: response.emotion, final: true }.
 *     (Graceful degradation for respond-only brains — non-breaking. respond() has no signal,
 *     so the fallback ignores options.signal.)
 *   - Throws if brain has neither method.
 *
 * Contract C — parseSseStream(body):
 *   - Input: async iterable of Uint8Array or string chunks (fetch response.body compatible).
 *   - Buffers by lines across chunk boundaries.
 *   - For each "data: {json}" line (space after the colon optional), JSON.parse and yield
 *     the object.
 *   - Ignores: empty lines, comment lines (: prefix), [DONE] sentinels, unparseable lines.
 */

/**
 * Parse a Server-Sent Events (SSE) stream into JSON objects.
 *
 * @param {AsyncIterable<Uint8Array|string>} body
 * @returns {AsyncGenerator<object>}
 */
export async function* parseSseStream(body) {
  const decoder = new TextDecoder();
  let remainder = "";

  for await (const rawChunk of body) {
    const chunk =
      typeof rawChunk === "string"
        ? rawChunk
        : decoder.decode(rawChunk, { stream: true });

    remainder += chunk;

    // Split on newlines but keep the line terminator accounted for.
    // We process complete lines only; incomplete trailing text stays in remainder.
    let start = 0;
    for (;;) {
      const nlIdx = remainder.indexOf("\n", start);
      if (nlIdx === -1) {
        // No more complete lines — keep the tail
        remainder = remainder.slice(start);
        break;
      }
      // Extract the line without the newline character
      const line = remainder.slice(start, nlIdx).replace(/\r$/, "");
      start = nlIdx + 1;

      // Empty line — SSE field separator, skip
      if (line === "") {
        continue;
      }
      // Comment line (: prefix) — skip
      if (line.startsWith(":")) {
        continue;
      }
      // Data line — the space after "data:" is optional per the SSE spec
      if (line.startsWith("data:")) {
        let payload = line.slice(5);
        if (payload.startsWith(" ")) {
          payload = payload.slice(1);
        }
        // [DONE] sentinel — skip
        if (payload === "[DONE]") {
          continue;
        }
        // Try to parse JSON
        try {
          yield JSON.parse(payload);
        } catch {
          // Unparseable — silently skip
        }
      }
    }
  }
}

/**
 * Wrap any brain in the streaming brain interface.
 *
 * @param {object} brain - A brain adapter with respond() or respondStream().
 * @param {object} context - The conversation context passed to the brain.
 * @param {{ signal?: AbortSignal }} [options] - Passed through to respondStream.
 *   The respond() fallback ignores it (respond has no signal support).
 * @returns {AsyncIterable<{ delta: string, emotion?: string, final?: boolean }>}
 */
export function toBrainStream(brain, context, options = {}) {
  if (typeof brain?.respondStream === "function") {
    return brain.respondStream(context, options);
  }
  if (typeof brain?.respond === "function") {
    return respondFallback(brain, context);
  }
  throw new Error(
    "toBrainStream: brain must implement respond() or respondStream()"
  );
}

async function* respondFallback(brain, context) {
  const response = await brain.respond(context);
  yield Object.freeze({
    delta: response?.text ?? "",
    emotion: response?.emotion,
    final: true
  });
}
