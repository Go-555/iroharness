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
