import assert from "node:assert/strict";
import test from "node:test";

import { createHookRegistry } from "../src/extension/hook-registry.js";
import {
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
} from "../src/index.js";

const createCapturingBrain = (id) => {
  let captured = null;
  return {
    id,
    async respond(context) {
      captured = context;
      return { text: "ok", emotion: "focused" };
    },
    captured: () => captured,
  };
};

const buildHarness = ({ hooks = null } = {}) => {
  const brain = createCapturingBrain("capture");
  const harness = createIroHarness({
    character: { id: "iroha", name: "Iroha", soul: "x", voiceStyle: "short" },
    projectOs: createInMemoryProjectOs(),
    userRegistry: createInMemoryUserRegistry(),
    brains: { voice: brain, text: brain },
    hooks,
  });
  return { harness, brain };
};

const sayHi = (harness, text = "hi") =>
  harness.receive({ source: "web", modality: "text", text });

test("a turn:before block hook denies the turn before the brain runs", async () => {
  const hooks = createHookRegistry();
  hooks.register("turn:before", () => ({ block: { reason: "nope" } }));
  const { harness, brain } = buildHarness({ hooks });
  const result = await sayHi(harness);
  assert.equal(result.kind, "hook_denied");
  assert.equal(result.reason, "nope");
  assert.equal(brain.captured(), null);
});

test("a harness without hooks behaves exactly as before", async () => {
  const { harness, brain } = buildHarness();
  const result = await sayHi(harness);
  assert.equal(result.kind, "response");
  assert.ok(brain.captured());
});

test("a turn:before transform rewrites the input the brain receives", async () => {
  const hooks = createHookRegistry();
  hooks.register("turn:before", (ctx) => ({
    transform: { input: { ...ctx.input, text: "REWRITTEN" } },
  }));
  const { harness, brain } = buildHarness({ hooks });
  await sayHi(harness, "original");
  assert.equal(brain.captured().input.text, "REWRITTEN");
});

test("a turn:before hook cannot forge the actor (protectedKeys)", async () => {
  const hooks = createHookRegistry();
  hooks.register("turn:before", () => ({
    transform: { actor: { user: { role: "owner" } } },
  }));
  const { harness, brain } = buildHarness({ hooks });
  await sayHi(harness);
  assert.notEqual(brain.captured().actor.user.role, "owner");
});

test("a turn:before block with no reason yields reason: null", async () => {
  const hooks = createHookRegistry();
  hooks.register("turn:before", () => ({ block: {} })); // no reason
  const { harness } = buildHarness({ hooks });
  const result = await sayHi(harness);
  assert.equal(result.kind, "hook_denied");
  assert.equal(result.reason, null); // not undefined
});
