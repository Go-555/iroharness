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

test("a command/agent hook on the device: prefix (device:emit) is rejected", () => {
  const registry = createHookRegistry();
  assert.throws(
    () =>
      registry.register("device:emit", () => undefined, { style: "command" }),
    /realtime/,
  );
  assert.throws(
    () => registry.register("device:emit", () => undefined, { style: "agent" }),
    /realtime/,
  );
  assert.doesNotThrow(() =>
    registry.register("device:emit", () => undefined, { style: "inprocess" }),
  );
});

test("every advertised realtime event is enforced by the prefix matcher (no drift)", () => {
  // Pins REALTIME_HOOK_EVENTS (discovery) to the prefix enforcement: a
  // command hook on any advertised realtime event must be rejected. Catches
  // drift where an event is added to the Set but not covered by a prefix.
  for (const event of REALTIME_HOOK_EVENTS) {
    const registry = createHookRegistry();
    assert.throws(
      () => registry.register(event, () => undefined, { style: "command" }),
      /realtime/,
      `expected ${event} to be enforced as realtime`,
    );
  }
});

test("register rejects an empty event name and a non-function handler", () => {
  const registry = createHookRegistry();
  assert.throws(() => registry.register("", () => undefined), /event/);
  assert.throws(() => registry.register("turn:before", null), /handler/);
});

test("the ./extension subpath export resolves the registry", async () => {
  const mod = await import("iroharness/extension");
  assert.equal(typeof mod.createHookRegistry, "function");
  assert.ok(mod.REALTIME_HOOK_EVENTS.has("bargein:detect"));
});

test("equal-priority handlers run in registration order", () => {
  const registry = createHookRegistry();
  const order = [];
  registry.register(
    "turn:before",
    () => {
      order.push("a");
      return undefined;
    },
    { priority: 5 },
  );
  registry.register(
    "turn:before",
    () => {
      order.push("b");
      return undefined;
    },
    { priority: 5 },
  );
  registry.dispatch("turn:before", {});
  assert.deepEqual(order, ["a", "b"]);
});

test("a throwing handler on a gate event fails closed (block)", () => {
  const registry = createHookRegistry();
  registry.register("turn:before", () => {
    throw new Error("boom");
  });
  const result = registry.dispatch("turn:before", { text: "hi" });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /hook error \(fail-closed\)/);
  assert.equal(result.context.text, "hi");
});

test("an unrecognized event fails closed on a handler throw (default-closed)", () => {
  const registry = createHookRegistry();
  registry.register("mystery:event", () => {
    throw new Error("boom");
  });
  assert.equal(registry.dispatch("mystery:event", {}).blocked, true);
});

test("a throwing handler on a background event fails open (skip, continue)", () => {
  const registry = createHookRegistry();
  const ran = [];
  registry.register("turn:after", () => {
    throw new Error("boom");
  });
  registry.register("turn:after", (ctx) => {
    ran.push(ctx.text);
    return undefined;
  });
  const result = registry.dispatch("turn:after", { text: "hi" });
  assert.equal(result.blocked, false);
  assert.deepEqual(ran, ["hi"]);
});

test("a throwing handler on a realtime event fails open (loop survives)", () => {
  const registry = createHookRegistry();
  registry.register(
    "bargein:detect",
    () => {
      throw new Error("boom");
    },
    { style: "inprocess" },
  );
  assert.equal(registry.dispatch("bargein:detect", {}).blocked, false);
});

test("transform cannot overwrite a protected key", () => {
  const registry = createHookRegistry();
  registry.register("turn:before", () => ({
    transform: { actor: { role: "owner" }, tag: "x" },
  }));
  const result = registry.dispatch(
    "turn:before",
    { actor: { role: "fan" }, tag: "" },
    { protectedKeys: ["actor"] },
  );
  assert.deepEqual(result.context.actor, { role: "fan" });
  assert.equal(result.context.tag, "x");
});

test("with no protectedKeys (2-arg call) transform merges unrestricted", () => {
  const registry = createHookRegistry();
  registry.register("turn:before", () => ({
    transform: { actor: { role: "owner" } },
  }));
  const result = registry.dispatch("turn:before", { actor: { role: "fan" } });
  assert.deepEqual(result.context.actor, { role: "owner" });
});

test("fail-closed throw preserves a prior handler's transform in the result context", () => {
  const registry = createHookRegistry();
  registry.register("turn:before", () => ({ transform: { tag: "first" } }), {
    priority: 10,
  });
  registry.register(
    "turn:before",
    () => {
      throw new Error("boom");
    },
    { priority: 0 },
  );
  const result = registry.dispatch("turn:before", { tag: "" });
  assert.equal(result.blocked, true);
  assert.equal(result.context.tag, "first"); // the earlier transform survived into the blocked result
});

test("a non-Error throw still produces a usable fail-closed reason", () => {
  const registry = createHookRegistry();
  registry.register("turn:before", () => {
    throw "stringy";
  });
  const result = registry.dispatch("turn:before", {});
  assert.equal(result.blocked, true);
  assert.match(result.reason, /stringy/);
});
