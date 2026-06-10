import assert from "node:assert/strict";
import test from "node:test";

import { createHookRegistry } from "../src/extension/hook-registry.js";
import {
  createEchoBrain,
  createHeuristicRouter,
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
  createRecorderDevice,
} from "../src/index.js";

const createDeveloperRegistry = () => {
  const userRegistry = createInMemoryUserRegistry();
  userRegistry.registerUser({
    id: "developer",
    displayName: "Developer",
    role: "developer",
    identities: { slack: "UDEV" },
  });
  return userRegistry;
};

const buildHarness = ({ brains, hooks = null } = {}) => {
  const recorder = createRecorderDevice("recorder");
  const harness = createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "Owns macro state.",
      voiceStyle: "short",
    },
    projectOs: createInMemoryProjectOs(),
    userRegistry: createDeveloperRegistry(),
    router: createHeuristicRouter(),
    brains: brains ?? {
      voice: createEchoBrain("voice-fast"),
      text: createEchoBrain("text-standard"),
    },
    devices: [recorder],
    hooks,
  });
  return { harness, recorder };
};

const collect = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
};

test("receiveStream happy path: respond-only brain yields one delta and finalize mirrors receive()", async () => {
  const { harness, recorder } = buildHarness();

  const { stream, finalize } = await harness.receiveStream({
    source: "web",
    modality: "voice",
    text: "こんにちは",
  });

  assert.notEqual(stream, null);
  assert.equal(typeof finalize, "function");

  const chunks = await collect(stream);
  assert.equal(chunks.length, 1);
  assert.equal(typeof chunks[0].delta, "string");
  assert.ok(chunks[0].delta.length > 0);
  assert.equal(chunks[0].final, true);

  const fullText = chunks.map((chunk) => chunk.delta).join("");
  const result = await finalize(fullText, { emotion: chunks[0].emotion });

  assert.equal(result.kind, "response");
  assert.equal(result.text, fullText);
  assert.equal(result.brainId, "voice-fast");

  // finalize mirrors receive(): speaking state carries the full text, then idle.
  const stateEvents = recorder.events().filter((event) => event.type === "state");
  const speaking = stateEvents.find((event) => event.state.mode === "speaking");
  assert.ok(speaking, "a speaking state must be emitted by finalize");
  assert.equal(speaking.state.speechText, fullText);
  assert.equal(harness.state().mode, "idle");
  assert.equal(harness.state().speechText, null);

  const speechEvents = recorder.events().filter((event) => event.type === "speech");
  assert.equal(speechEvents.length, 1);
  assert.equal(speechEvents[0].text, fullText);
  assert.equal(speechEvents[0].brainId, "voice-fast");
});

test("receiveStream with a streaming brain yields deltas in order and finalize returns the joined text", async () => {
  const streamingBrain = Object.freeze({
    id: "voice-streaming",
    async respond() {
      return { text: "ふたつ。", emotion: "attentive" };
    },
    async *respondStream() {
      yield { delta: "ひと", emotion: "attentive" };
      yield { delta: "つずつ。", emotion: "attentive", final: true };
    },
  });
  const { harness } = buildHarness({
    brains: {
      voice: streamingBrain,
      text: createEchoBrain("text-standard"),
    },
  });

  const { stream, finalize } = await harness.receiveStream({
    source: "web",
    modality: "voice",
    text: "こんにちは",
  });

  const chunks = await collect(stream);
  assert.deepEqual(
    chunks.map((chunk) => chunk.delta),
    ["ひと", "つずつ。"],
  );

  const result = await finalize("ひとつずつ。", { emotion: "attentive" });
  assert.equal(result.kind, "response");
  assert.equal(result.text, "ひとつずつ。");
  assert.equal(result.brainId, "voice-streaming");
});

test("receiveStream resolves stream: null with the exact receive() result when permission is denied", async () => {
  const deniedInput = Object.freeze({
    source: "youtube",
    modality: "text",
    text: "設計について深い議論をしたい",
    actor: Object.freeze({
      platform: "youtube",
      platformUserId: "UCFAN",
      displayName: "Fan",
    }),
  });

  const receiveHarness = buildHarness().harness;
  const receiveResult = await receiveHarness.receive(deniedInput);
  assert.equal(receiveResult.kind, "permission_denied");

  const streamHarness = buildHarness().harness;
  const streamed = await streamHarness.receiveStream(deniedInput);
  assert.equal(streamed.stream, null);
  assert.equal(typeof streamed.finalize, "undefined");
  assert.deepEqual(streamed.result, receiveResult);
});

test("receiveStream passes the caller's signal through to the streaming brain", async () => {
  let capturedOptions = null;
  let capturedContext = null;
  const signalBrain = Object.freeze({
    id: "voice-signal",
    async respond() {
      return { text: "ok", emotion: "attentive" };
    },
    async *respondStream(context, options) {
      capturedContext = context;
      capturedOptions = options;
      yield { delta: "ok", final: true };
    },
  });
  const { harness } = buildHarness({
    brains: {
      voice: signalBrain,
      text: createEchoBrain("text-standard"),
    },
  });

  const controller = new AbortController();
  const { stream } = await harness.receiveStream(
    {
      source: "web",
      modality: "voice",
      text: "こんにちは",
    },
    { signal: controller.signal },
  );

  await collect(stream);
  assert.equal(capturedOptions.signal, controller.signal);
  // The streaming brain receives the same gated context receive() would build.
  assert.equal(capturedContext.character.id, "iroha");
  assert.equal(capturedContext.route.kind, "voice");
  assert.ok(capturedContext.actor);
  assert.ok(capturedContext.audience);
});

const startTurn = (harness) =>
  harness.receiveStream({
    source: "web",
    modality: "voice",
    text: "こんにちは",
  });

test("abandon() resets state to idle without any speech emit", async () => {
  const { harness, recorder } = buildHarness();
  const { abandon } = await startTurn(harness);

  // prepareTurn left the harness thinking; an abandoned turn must not wedge it.
  assert.equal(harness.state().mode, "thinking");
  abandon();

  assert.equal(harness.state().mode, "idle");
  assert.equal(harness.state().speechText, null);
  assert.equal(harness.state().mouth, "closed");
  assert.equal(
    recorder.events().filter((event) => event.type === "speech").length,
    0,
  );
});

test("finalize() after abandon() is a no-op returning null", async () => {
  const { harness, recorder } = buildHarness();
  const { finalize, abandon } = await startTurn(harness);

  abandon();
  const eventsBefore = recorder.events().length;
  const stateBefore = harness.state();

  const result = await finalize("喋らないで");

  assert.equal(result, null);
  assert.equal(recorder.events().length, eventsBefore);
  assert.deepEqual(harness.state(), stateBefore);
});

test("abandon() after finalize() is a no-op", async () => {
  const { harness, recorder } = buildHarness();
  const { finalize, abandon } = await startTurn(harness);

  const result = await finalize("やあ");
  assert.equal(result.kind, "response");
  assert.equal(result.text, "やあ");

  const eventsBefore = recorder.events().length;
  const stateBefore = harness.state();
  abandon();

  assert.equal(recorder.events().length, eventsBefore);
  assert.deepEqual(harness.state(), stateBefore);
});

test("a second finalize() returns null and emits nothing", async () => {
  const { harness, recorder } = buildHarness();
  const { finalize } = await startTurn(harness);

  const first = await finalize("やあ");
  assert.equal(first.kind, "response");

  const eventsBefore = recorder.events().length;
  const second = await finalize("やあ");

  assert.equal(second, null);
  assert.equal(recorder.events().length, eventsBefore);
  assert.equal(
    recorder.events().filter((event) => event.type === "speech").length,
    1,
  );
});

test("receiveStream resolves stream: null with the exact receive() result when a turn:before hook blocks", async () => {
  const blockedInput = Object.freeze({
    source: "web",
    modality: "voice",
    text: "こんにちは",
  });
  const makeHooks = () => {
    const hooks = createHookRegistry();
    hooks.register("turn:before", () => ({ block: { reason: "nope" } }));
    return hooks;
  };

  const receiveHarness = buildHarness({ hooks: makeHooks() }).harness;
  const receiveResult = await receiveHarness.receive(blockedInput);
  assert.equal(receiveResult.kind, "hook_denied");
  assert.equal(receiveResult.reason, "nope");

  const streamHarness = buildHarness({ hooks: makeHooks() }).harness;
  const streamed = await streamHarness.receiveStream(blockedInput);
  assert.equal(streamed.stream, null);
  assert.equal(typeof streamed.finalize, "undefined");
  assert.equal(typeof streamed.abandon, "undefined");
  assert.deepEqual(streamed.result, receiveResult);
});
