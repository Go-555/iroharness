import assert from "node:assert/strict";
import test from "node:test";

import {
  createEchoBrain,
  createHeuristicRouter,
  createHttpBrain,
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
  createRecorderDevice,
  createStubMicroHarness
} from "../src/index.js";

const createNamedBrain = (id, text) =>
  Object.freeze({
    id,
    async respond() {
      return { text, emotion: "focused" };
    }
  });

const createHarness = () => {
  const projectOs = createInMemoryProjectOs();
  const userRegistry = createInMemoryUserRegistry();
  userRegistry.registerUser({
    id: "developer",
    displayName: "Developer",
    role: "developer",
    identities: { slack: "UDEV" }
  });
  const recorder = createRecorderDevice("recorder");
  const harness = createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "Owns macro state.",
      voiceStyle: "short"
    },
    projectOs,
    userRegistry,
    router: createHeuristicRouter(),
    brains: {
      voice: createEchoBrain("voice-fast"),
      text: createEchoBrain("text-deep")
    },
    devices: [recorder],
    microHarnesses: [createStubMicroHarness("codex", ["code"])]
  });
  return { harness, recorder };
};

test("voice input uses the voice brain without creating a PJOS ticket", async () => {
  const { harness, recorder } = createHarness();
  const result = await harness.receive({
    source: "web",
    modality: "voice",
    text: "こんにちは"
  });

  assert.equal(result.kind, "response");
  assert.equal(result.brainId, "voice-fast");
  assert.equal(harness.projectOs().tickets.length, 0);
  assert.equal(recorder.events().some((event) => event.type === "speech"), true);
});

test("deep text input uses the deep brain when configured", async () => {
  const projectOs = createInMemoryProjectOs();
  const userRegistry = createInMemoryUserRegistry();
  userRegistry.registerUser({
    id: "developer",
    displayName: "Developer",
    role: "developer",
    identities: { slack: "UDEV" }
  });
  const harness = createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "Owns macro state.",
      voiceStyle: "short"
    },
    projectOs,
    userRegistry,
    router: createHeuristicRouter(),
    brains: {
      voice: createNamedBrain("voice-fast", "voice"),
      text: createNamedBrain("text-standard", "text"),
      deep: createNamedBrain("text-deep", "deep")
    }
  });

  const result = await harness.receive({
    source: "slack",
    modality: "text",
    text: "このアーキテクチャ設計について深い議論をしたい",
    actor: {
      platform: "slack",
      platformUserId: "UDEV",
      displayName: "Developer"
    }
  });

  assert.equal(result.kind, "response");
  assert.equal(result.route.kind, "deep");
  assert.equal(result.brainId, "text-deep");
  assert.equal(result.text, "deep");
});

test("voice input keeps the low-latency voice brain even with deep words", async () => {
  const projectOs = createInMemoryProjectOs();
  const userRegistry = createInMemoryUserRegistry();
  userRegistry.registerUser({
    id: "developer",
    displayName: "Developer",
    role: "developer",
    identities: { slack: "UDEV" }
  });
  const harness = createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "Owns macro state.",
      voiceStyle: "short"
    },
    projectOs,
    userRegistry,
    router: createHeuristicRouter(),
    brains: {
      voice: createNamedBrain("voice-fast", "voice"),
      text: createNamedBrain("text-standard", "text"),
      deep: createNamedBrain("text-deep", "deep")
    }
  });

  const result = await harness.receive({
    source: "slack",
    modality: "voice",
    text: "設計について話そう",
    actor: {
      platform: "slack",
      platformUserId: "UDEV",
      displayName: "Developer"
    }
  });

  assert.equal(result.route.kind, "voice");
  assert.equal(result.brainId, "voice-fast");
  assert.equal(result.text, "voice");
});

test("HTTP brain posts full macro context and returns model response", async () => {
  const calls = [];
  const brain = createHttpBrain({
    id: "deep-http",
    endpoint: "http://brain.local/respond",
    model: "deep-model",
    fetchImpl: async (_endpoint, options) => {
      calls.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            text: "HTTP brain response",
            emotion: "focused"
          });
        }
      };
    }
  });

  const response = await brain.respond({
    character: { id: "iroha" },
    actor: { user: { id: "developer" } },
    input: { text: "設計相談" },
    route: { kind: "deep" },
    state: { mode: "thinking" },
    projectOs: { tickets: [] }
  });

  assert.equal(response.text, "HTTP brain response");
  assert.equal(response.emotion, "focused");
  assert.equal(calls[0].model, "deep-model");
  assert.equal(calls[0].route.kind, "deep");
});

test("work input delegates to a micro harness and records ticket/run state", async () => {
  const { harness, recorder } = createHarness();
  const result = await harness.receive({
    source: "slack",
    modality: "text",
    text: "Codexでこのコードをレビューして",
    actor: {
      platform: "slack",
      platformUserId: "UDEV",
      displayName: "Developer"
    }
  });

  const snapshot = harness.projectOs();
  assert.equal(result.kind, "delegation");
  assert.equal(result.route.harnessId, "codex");
  assert.equal(snapshot.tickets.length, 1);
  assert.equal(snapshot.tickets[0].executorHarnessId, "codex");
  assert.equal(snapshot.tickets[0].status, "done");
  assert.equal(snapshot.runs.length, 1);
  assert.equal(snapshot.runs[0].status, "completed");
  assert.equal(recorder.events().some((event) => event.type === "task"), true);
});
