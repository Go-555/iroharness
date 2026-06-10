/**
 * Tests for brain streaming contract (Task 7 + Task 8).
 *
 * Covers:
 *   - toBrainStream fallback (respond-only brain)
 *   - toBrainStream passthrough (brain with respondStream)
 *   - toBrainStream throws for brain with neither method
 *   - parseSseStream: split mid-line, [DONE], comments, garbage
 *   - createOpenAiResponsesBrain.respondStream: deltas collected, stream:true sent, non-ok throws
 *   - createCodexAppServerBrain.respondStream: delta events, final-only degradation, abort
 */

import assert from "node:assert/strict";
import test from "node:test";

import { toBrainStream, parseSseStream } from "../src/voice-pipeline/brain-stream.js";
import { createOpenAiResponsesBrain, createCodexAppServerBrain } from "../src/adapters/index.js";

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

// ---------------------------------------------------------------------------
// Contract E: createCodexAppServerBrain.respondStream (Task 8)
// ---------------------------------------------------------------------------

/**
 * Creates a fake Codex app-server transport for testing.
 * Mirrors the createFakeCodexTransport helper from adapters.test.js.
 * By default emits two item/agentMessage/delta events then turn/completed.
 */
const createFakeCodexTransport = (
  {
    deltas = ["今日は", "晴れ。"],
    finalOnly = false
  } = {}
) => {
  let listeners = [];
  const requests = [];
  const emit = (event) => {
    listeners.forEach((listener) => listener(event));
  };
  return {
    requests,
    async initialize() {
      requests.push({ method: "initialize" });
    },
    async sendRequest(method, params) {
      requests.push({ method, params });
      if (method === "thread/start") {
        return { thread: { id: "thread_1" } };
      }
      if (method === "turn/start") {
        setTimeout(() => {
          if (!finalOnly) {
            for (const delta of deltas) {
              emit({ method: "item/agentMessage/delta", params: { delta } });
            }
          }
          emit({ method: "turn/completed", params: { turn: { id: "turn_1" } } });
        }, 0);
        return { turn: { id: "turn_1" } };
      }
      return {};
    },
    subscribe(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((c) => c !== listener);
      };
    },
    close() {}
  };
};

test("Codex respondStream: collects delta events in order", async () => {
  const transport = createFakeCodexTransport({ deltas: ["今日は", "晴れ。"] });
  const brain = createCodexAppServerBrain({
    id: "codex-stream-test",
    slot: "voice",
    cwd: "/tmp/project",
    model: "gpt-brain-test",
    transport,
    timeoutMs: 1000
  });

  const context = { input: { text: "天気は？" } };
  const items = await collect(brain.respondStream(context));

  assert.deepEqual(
    items.map((i) => i.delta),
    ["今日は", "晴れ。"]
  );
  // No false final flags on intermediate deltas
  assert.equal(items[0].final, undefined);
});

test("Codex respondStream: graceful degradation when transport emits no deltas (final-only)", async () => {
  // When the app-server emits turn/completed with no preceding delta events,
  // respondStream yields the accumulated text (empty in this case) as a single
  // delta with final:true — matches Contract A's graceful-degradation clause.
  const transport = createFakeCodexTransport({ deltas: [], finalOnly: true });
  // Override: emit one final event but no delta events
  // We patch sendRequest to emit turn/completed without any deltas
  const brain = createCodexAppServerBrain({
    id: "codex-final-only",
    slot: "voice",
    cwd: "/tmp/project",
    model: "gpt-brain-test",
    transport,
    timeoutMs: 1000
  });

  const items = await collect(brain.respondStream({ input: { text: "hi" } }));

  assert.equal(items.length, 1);
  assert.equal(items[0].final, true);
  assert.equal(typeof items[0].delta, "string");
});

test("Codex respondStream: abort mid-stream stops iteration without unhandled rejection", async () => {
  let listeners = [];
  let emitRef = null;
  const transport = {
    requests: [],
    async initialize() {
      this.requests.push({ method: "initialize" });
    },
    async sendRequest(method, params) {
      this.requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: "thread_1" } };
      if (method === "turn/start") {
        // Emit one delta immediately, hold the second
        setTimeout(() => {
          listeners.forEach((l) =>
            l({ method: "item/agentMessage/delta", params: { delta: "first" } })
          );
          // Hold completion — caller will abort before it fires
          emitRef = () => {
            listeners.forEach((l) =>
              l({ method: "turn/completed", params: { turn: { id: "turn_1" } } })
            );
          };
        }, 0);
        return { turn: { id: "turn_1" } };
      }
      return {};
    },
    subscribe(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((c) => c !== listener);
      };
    },
    close() {}
  };

  const brain = createCodexAppServerBrain({
    id: "codex-abort-test",
    slot: "voice",
    cwd: "/tmp/project",
    model: "gpt-brain-test",
    transport,
    timeoutMs: 2000
  });

  const controller = new AbortController();
  const collected = [];

  const iter = brain.respondStream({ input: { text: "hi" } }, { signal: controller.signal });
  // Collect first delta then abort
  for await (const item of iter) {
    collected.push(item);
    controller.abort();
    break;
  }

  assert.equal(collected.length, 1);
  assert.equal(collected[0].delta, "first");
  // No unhandled rejection — test completes cleanly
});
