/**
 * Tests for brain streaming contract (Task 7).
 *
 * Covers:
 *   - toBrainStream fallback (respond-only brain)
 *   - toBrainStream passthrough (brain with respondStream)
 *   - toBrainStream throws for brain with neither method
 *   - parseSseStream: split mid-line, [DONE], comments, garbage
 *   - createOpenAiResponsesBrain.respondStream: deltas collected, stream:true sent, non-ok throws
 */

import assert from "node:assert/strict";
import test from "node:test";

import { toBrainStream, parseSseStream } from "../src/voice-pipeline/brain-stream.js";
import { createOpenAiResponsesBrain } from "../src/adapters/index.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const collect = async (iter) => {
  const items = [];
  for await (const item of iter) {
    items.push(item);
  }
  return items;
};

const makeBody = (chunks) => ({
  [Symbol.asyncIterator]: async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  }
});

// Stub value for unit-test mock calls — never a real credential.
const STUB = "test-key";

// ---------------------------------------------------------------------------
// Contract B: toBrainStream
// ---------------------------------------------------------------------------

test("toBrainStream fallback: respond-only brain yields single delta with emotion and final", async () => {
  const brain = {
    async respond(_context) {
      return { text: "こんにちは。", emotion: "calm" };
    }
  };
  const context = { input: { text: "hi" } };
  const items = await collect(toBrainStream(brain, context));

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { delta: "こんにちは。", emotion: "calm", final: true });
});

test("toBrainStream fallback: respond-only brain with missing text yields empty delta", async () => {
  const brain = {
    async respond(_context) {
      return { emotion: "neutral" };
    }
  };
  const items = await collect(toBrainStream(brain, {}));
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { delta: "", emotion: "neutral", final: true });
});

test("toBrainStream passthrough: brain with respondStream returns its iterable", async () => {
  const expectedDeltas = [
    { delta: "今日は" },
    { delta: "晴れ。", final: true }
  ];
  const brain = {
    respondStream(_context) {
      return (async function* () {
        for (const item of expectedDeltas) {
          yield item;
        }
      })();
    }
  };
  const items = await collect(toBrainStream(brain, {}));
  assert.deepEqual(items, expectedDeltas);
});

test("toBrainStream forwards options (signal) to brain.respondStream", async () => {
  const captured = [];
  const brain = {
    respondStream(context, options) {
      captured.push({ context, options });
      return (async function* () {
        yield { delta: "ok", final: true };
      })();
    }
  };
  const controller = new AbortController();
  const context = { input: { text: "hi" } };
  const items = await collect(toBrainStream(brain, context, { signal: controller.signal }));

  assert.equal(items.length, 1);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].context, context);
  assert.equal(captured[0].options.signal, controller.signal);
});

test("toBrainStream throws for brain with neither respond nor respondStream", async () => {
  const brain = { id: "broken-brain" };
  await assert.rejects(
    async () => {
      for await (const _ of toBrainStream(brain, {})) {
        // should throw before yielding
      }
    },
    /respond/i
  );
});

// ---------------------------------------------------------------------------
// Contract C: parseSseStream
// ---------------------------------------------------------------------------

test("parseSseStream: two complete events in one chunk", async () => {
  const body = makeBody(['data: {"a":1}\n\ndata: {"b":2}\n\n']);
  const items = await collect(parseSseStream(body));
  assert.deepEqual(items, [{ a: 1 }, { b: 2 }]);
});

test("parseSseStream: event split mid-line across two chunks", async () => {
  // The second chunk starts mid-line inside {"b": 2}
  const body = makeBody(['data: {"a":1}\n\ndata: {"b"', ':2}\n\n']);
  const items = await collect(parseSseStream(body));
  assert.deepEqual(items, [{ a: 1 }, { b: 2 }]);
});

test("parseSseStream: [DONE] sentinel is ignored", async () => {
  const body = makeBody(['data: {"a":1}\n\ndata: [DONE]\n\n']);
  const items = await collect(parseSseStream(body));
  assert.deepEqual(items, [{ a: 1 }]);
});

test("parseSseStream: comment lines (: prefix) are ignored", async () => {
  const body = makeBody([': keep-alive\n\ndata: {"x":42}\n\n']);
  const items = await collect(parseSseStream(body));
  assert.deepEqual(items, [{ x: 42 }]);
});

test("parseSseStream: garbage (unparseable JSON) lines are silently skipped", async () => {
  const body = makeBody(['data: not-json\n\ndata: {"ok":true}\n\n']);
  const items = await collect(parseSseStream(body));
  assert.deepEqual(items, [{ ok: true }]);
});

test("parseSseStream: empty lines between events produce no extra yields", async () => {
  const body = makeBody(['\n\ndata: {"n":1}\n\n\n\n']);
  const items = await collect(parseSseStream(body));
  assert.deepEqual(items, [{ n: 1 }]);
});

test("parseSseStream: Uint8Array chunks are decoded correctly", async () => {
  const encoder = new TextEncoder();
  const body = makeBody([encoder.encode('data: {"u":8}\n\n')]);
  const items = await collect(parseSseStream(body));
  assert.deepEqual(items, [{ u: 8 }]);
});

test("parseSseStream: data: without space is accepted", async () => {
  const body = makeBody(['data:{"c":3}\n\n']);
  const items = await collect(parseSseStream(body));
  assert.deepEqual(items, [{ c: 3 }]);
});

test("parseSseStream: data: without space [DONE] sentinel is ignored", async () => {
  const body = makeBody(['data:[DONE]\n\ndata:{"d":4}\n\n']);
  const items = await collect(parseSseStream(body));
  assert.deepEqual(items, [{ d: 4 }]);
});

// ---------------------------------------------------------------------------
// Contract D: createOpenAiResponsesBrain.respondStream
// ---------------------------------------------------------------------------

const makeSseBody = (events) =>
  makeBody(
    events.map((obj) => `data: ${JSON.stringify(obj)}\n\n`)
  );

test("OpenAI respondStream: collects deltas from response.output_text.delta events", async () => {
  const calls = [];
  const brain = createOpenAiResponsesBrain({
    id: "stream-test",
    slot: "voice",
    apiKey: STUB,
    baseUrl: "https://api.test/v1",
    model: "gpt-stream-test",
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, body: JSON.parse(options.body) });
      return {
        ok: true,
        body: makeSseBody([
          { type: "response.output_text.delta", delta: "今日" },
          { type: "response.output_text.delta", delta: "は晴れ。" },
          { type: "response.completed" }
        ])
      };
    }
  });

  const context = { input: { text: "天気は？" } };
  const items = await collect(brain.respondStream(context));

  assert.deepEqual(
    items.map((i) => i.delta),
    ["今日", "は晴れ。"]
  );
  assert.equal(calls[0].endpoint, "https://api.test/v1/responses");
  assert.equal(calls[0].body.stream, true, "request body must have stream:true");
});

test("OpenAI respondStream: forwards AbortSignal to fetchImpl options", async () => {
  const captured = [];
  const brain = createOpenAiResponsesBrain({
    id: "stream-abort",
    slot: "voice",
    apiKey: STUB,
    baseUrl: "https://api.test/v1",
    model: "gpt-stream-test",
    fetchImpl: async (endpoint, options) => {
      captured.push(options);
      return {
        ok: true,
        body: makeSseBody([
          { type: "response.output_text.delta", delta: "ok" },
          { type: "response.completed" }
        ])
      };
    }
  });

  const controller = new AbortController();
  const items = await collect(
    brain.respondStream({ input: { text: "hi" } }, { signal: controller.signal })
  );

  assert.deepEqual(items.map((i) => i.delta), ["ok"]);
  assert.equal(captured[0].signal, controller.signal);
});

test("OpenAI respondStream: works without options (signal undefined)", async () => {
  const captured = [];
  const brain = createOpenAiResponsesBrain({
    id: "stream-no-options",
    slot: "voice",
    apiKey: STUB,
    baseUrl: "https://api.test/v1",
    model: "gpt-stream-test",
    fetchImpl: async (endpoint, options) => {
      captured.push(options);
      return {
        ok: true,
        body: makeSseBody([
          { type: "response.output_text.delta", delta: "ok" },
          { type: "response.completed" }
        ])
      };
    }
  });

  const items = await collect(brain.respondStream({ input: { text: "hi" } }));
  assert.deepEqual(items.map((i) => i.delta), ["ok"]);
  assert.equal(captured[0].signal, undefined);
});

test("OpenAI respondStream: non-ok response throws with status", async () => {
  const brain = createOpenAiResponsesBrain({
    id: "stream-err",
    slot: "voice",
    apiKey: STUB,
    baseUrl: "https://api.test/v1",
    model: "gpt-stream-test",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      async text() {
        return "rate limited";
      }
    })
  });

  await assert.rejects(
    async () => {
      for await (const _ of brain.respondStream({})) {
        // should throw before first yield
      }
    },
    /429/
  );
});

test("OpenAI respondStream: events with other types are ignored", async () => {
  const brain = createOpenAiResponsesBrain({
    id: "stream-ignore",
    slot: "voice",
    apiKey: STUB,
    baseUrl: "https://api.test/v1",
    model: "gpt-stream-test",
    fetchImpl: async () => ({
      ok: true,
      body: makeSseBody([
        { type: "response.created" },
        { type: "response.output_item.added" },
        { type: "response.output_text.delta", delta: "hello" },
        { type: "response.completed" }
      ])
    })
  });

  const items = await collect(brain.respondStream({}));
  assert.deepEqual(
    items.map((i) => i.delta),
    ["hello"]
  );
});
