import assert from "node:assert/strict";
import test from "node:test";

import { createHookRegistry } from "../src/extension/hook-registry.js";
import {
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
  createStubMicroHarness,
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

const buildHarness = ({ hooks = null, work = false } = {}) => {
  const userRegistry = createInMemoryUserRegistry();
  if (work) {
    userRegistry.registerUser({
      id: "developer",
      displayName: "Developer",
      role: "developer",
      identities: { slack: "UDEV" },
    });
  }
  const brain = createCapturingBrain("capture");
  const harness = createIroHarness({
    character: { id: "iroha", name: "Iroha", soul: "x", voiceStyle: "short" },
    projectOs: createInMemoryProjectOs(),
    userRegistry,
    brains: { voice: brain, text: brain },
    microHarnesses: work ? [createStubMicroHarness("codex", ["code"])] : [],
    hooks,
  });
  return { harness, brain };
};

const sayHi = (harness, text = "hi") =>
  harness.receive({ source: "web", modality: "text", text });

const delegateWork = (harness) =>
  harness.receive({
    source: "slack",
    modality: "text",
    text: "Codexでこのコードをレビューして",
    actor: { platform: "slack", platformUserId: "UDEV" },
  });

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

test("a turn:before hook cannot escalate by mutating ctx.actor in place (denied)", async () => {
  const hooks = createHookRegistry();
  hooks.register("turn:before", (ctx) => {
    // Forge attempt via in-place nested mutation; the §6 deep-freeze makes this
    // throw, which fails closed on the gate event -> the turn is denied.
    ctx.actor.user.role = "owner";
    return undefined;
  });
  const { harness, brain } = buildHarness({ hooks });
  const result = await sayHi(harness);
  assert.equal(result.kind, "hook_denied"); // mutation threw -> fail-closed deny
  assert.equal(brain.captured(), null); // brain never ran
  // and the actor in the denial envelope was not elevated
  assert.notEqual(result.actor.user.role, "owner");
});

test("a tool:before block hook denies the delegation before the micro-harness runs", async () => {
  const hooks = createHookRegistry();
  hooks.register("tool:before", () => ({ block: { reason: "no tools" } }));
  const { harness } = buildHarness({ hooks, work: true });
  const result = await delegateWork(harness);
  assert.equal(result.kind, "hook_denied");
  assert.equal(result.reason, "no tools");
  assert.equal(harness.projectOs().tickets.length, 0);
});

test("with no tool:before hook the work route still delegates", async () => {
  const { harness } = buildHarness({ hooks: createHookRegistry(), work: true });
  const result = await delegateWork(harness);
  assert.equal(result.kind, "delegation");
  assert.equal(harness.projectOs().tickets.length, 1);
});

test("a response:before block hook suppresses the brain response", async () => {
  const hooks = createHookRegistry();
  hooks.register("response:before", () => ({ block: { reason: "filtered" } }));
  const { harness } = buildHarness({ hooks });
  const result = await harness.receive({
    source: "web",
    modality: "text",
    text: "hi",
  });
  assert.equal(result.kind, "hook_denied");
  assert.equal(result.reason, "filtered");
  assert.notEqual(result.text, "ok");
});

test("a response:before transform rewrites the emitted/returned response text", async () => {
  const hooks = createHookRegistry();
  hooks.register("response:before", (ctx) => ({
    transform: { response: { ...ctx.response, text: "MODERATED" } },
  }));
  const { harness } = buildHarness({ hooks });
  const result = await harness.receive({
    source: "web",
    modality: "text",
    text: "hi",
  });
  assert.equal(result.kind, "response");
  assert.equal(result.text, "MODERATED");
});

test("a response:before hook cannot forge the actor (protectedKeys)", async () => {
  const hooks = createHookRegistry();
  hooks.register("response:before", () => ({
    transform: { actor: { user: { role: "owner" } } },
  }));
  const { harness } = buildHarness({ hooks });
  const result = await harness.receive({
    source: "web",
    modality: "text",
    text: "hi",
  });
  assert.equal(result.kind, "response");
  assert.notEqual(result.actor.user.role, "owner");
});
