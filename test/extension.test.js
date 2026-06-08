import assert from "node:assert/strict";
import test from "node:test";

import { createHookRegistry } from "../src/extension/hook-registry.js";

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
