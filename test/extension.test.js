import assert from "node:assert/strict";
import test from "node:test";

import {
  createHookRegistry,
  REALTIME_HOOK_EVENTS,
} from "../src/extension/hook-registry.js";

test("dispatch with no handlers passes the context through unblocked", () => {
  const registry = createHookRegistry();
  const result = registry.dispatch("turn:before", { text: "hi" });
  assert.equal(result.blocked, false);
  assert.equal(result.context.text, "hi");
});

test("a single in-process handler runs and can pass through", () => {
  const registry = createHookRegistry();
  const seen = [];
  registry.register("turn:before", (ctx) => {
    seen.push(ctx.text);
    return undefined;
  });
  const result = registry.dispatch("turn:before", { text: "hi" });
  assert.deepEqual(seen, ["hi"]);
  assert.equal(result.blocked, false);
});

test("a handler returning block stops dispatch and skips later handlers", () => {
  const registry = createHookRegistry();
  const ran = [];
  registry.register("tool:before", () => {
    ran.push("first");
    return { block: { reason: "denied" } };
  });
  registry.register("tool:before", () => {
    ran.push("second");
    return undefined;
  });
  const result = registry.dispatch("tool:before", { tool: "codex" });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "denied");
  assert.deepEqual(ran, ["first"]);
});

test("handlers run in priority order and transform merges into the context", () => {
  const registry = createHookRegistry();
  const order = [];
  registry.register(
    "turn:before",
    (ctx) => {
      order.push("low");
      return { transform: { tag: `${ctx.tag || ""}low` } };
    },
    { priority: 0 },
  );
  registry.register(
    "turn:before",
    (ctx) => {
      order.push("high");
      return { transform: { tag: `${ctx.tag || ""}high-` } };
    },
    { priority: 10 },
  );
  const result = registry.dispatch("turn:before", { tag: "" });
  assert.deepEqual(order, ["high", "low"]);
  assert.equal(result.context.tag, "high-low");
});

test("registering a command/agent hook on a realtime event throws", () => {
  const registry = createHookRegistry();
  assert.throws(
    () =>
      registry.register("bargein:detect", () => undefined, {
        style: "command",
      }),
    /realtime/,
  );
  assert.throws(
    () =>
      registry.register("speech:before", () => undefined, { style: "agent" }),
    /realtime/,
  );
});

test("an in-process hook on a realtime event is allowed", () => {
  const registry = createHookRegistry();
  assert.doesNotThrow(() =>
    registry.register(
      "bargein:detect",
      () => ({ block: { reason: "interrupted" } }),
      {
        style: "inprocess",
      },
    ),
  );
});

test("REALTIME_HOOK_EVENTS lists the protected realtime points", () => {
  assert.ok(REALTIME_HOOK_EVENTS.has("bargein:detect"));
  assert.ok(REALTIME_HOOK_EVENTS.has("speech:before"));
  assert.ok(REALTIME_HOOK_EVENTS.has("speech:chunk"));
  assert.ok(REALTIME_HOOK_EVENTS.has("device:emit"));
});

test("register rejects an empty event name and a non-function handler", () => {
  const registry = createHookRegistry();
  assert.throws(() => registry.register("", () => undefined), /event/);
  assert.throws(() => registry.register("turn:before", null), /handler/);
});
