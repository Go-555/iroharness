import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createEchoBrain,
  createFileCharacterProfile,
  createHeuristicRouter,
  createHttpBrain,
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
  createRecorderDevice,
  createRecorderStreamController,
  createStubMicroHarness
} from "../src/index.js";

const createNamedBrain = (id, text) =>
  Object.freeze({
    id,
    async respond() {
      return { text, emotion: "focused" };
    }
  });

test("file character profile loads SOUL, IDENTITY, MEMORY, and VOICE markdown", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-character-"));
  writeFileSync(join(dir, "SOUL.md"), "Calm macro harness identity.", "utf8");
  writeFileSync(join(dir, "IDENTITY.md"), "Name: Iroha", "utf8");
  writeFileSync(join(dir, "MEMORY.md"), "Likes durable PJOS state.", "utf8");
  writeFileSync(join(dir, "VOICE.md"), "short and clear", "utf8");

  const character = createFileCharacterProfile({
    dir,
    id: "iroha",
    name: "Iroha"
  });

  assert.equal(character.id, "iroha");
  assert.equal(character.name, "Iroha");
  assert.equal(character.soul, "Calm macro harness identity.");
  assert.equal(character.identity, "Name: Iroha");
  assert.equal(character.memory, "Likes durable PJOS state.");
  assert.equal(character.voiceStyle, "short and clear");
  assert.match(character.metadata.sourceFiles.soul, /SOUL\.md$/);
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
      text: createEchoBrain("text-standard")
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

test("deep text input uses the text brain", async () => {
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
      text: createNamedBrain("text-standard", "text")
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
  assert.equal(result.route.kind, "text");
  assert.equal(result.brainId, "text-standard");
  assert.equal(result.text, "text");
});

test("developer deep discussion keeps character identity on the text brain", async () => {
  const calls = [];
  const projectOs = createInMemoryProjectOs();
  const userRegistry = createInMemoryUserRegistry();
  userRegistry.registerUser({
    id: "developer",
    displayName: "Developer",
    role: "developer",
    relationship: "core-developer",
    identities: { discord: "DDEV" }
  });
  const harness = createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "Stable identity across all bodies.",
      voiceStyle: "short"
    },
    projectOs,
    userRegistry,
    router: createHeuristicRouter(),
    brains: {
      voice: createNamedBrain("voice-fast", "voice"),
      text: Object.freeze({
        id: "text-standard",
        async respond(context) {
          calls.push(context);
          return { text: "text", emotion: "focused" };
        }
      })
    }
  });

  const result = await harness.receive({
    source: "discord",
    modality: "text",
    text: "IroHarnessの設計思想について深い議論をしたい",
    actor: {
      platform: "discord",
      platformUserId: "DDEV",
      displayName: "Developer"
    }
  });

  assert.equal(result.kind, "response");
  assert.equal(result.brainId, "text-standard");
  assert.equal(result.audience.tier, "trusted");
  assert.equal(result.audience.responseDepth, "standard");
  assert.equal(result.audience.canDeepDiscuss, true);
  assert.equal(result.audience.identityStable, true);
  assert.equal(calls[0].character.soul, "Stable identity across all bodies.");
  assert.equal(calls[0].audience.relationship, "core-developer");
  assert.equal(calls[0].route.kind, "text");
});

test("fan deep discussion is denied by permission without changing personality", async () => {
  const userRegistry = createInMemoryUserRegistry();
  userRegistry.registerUser({
    id: "fan_1",
    displayName: "Fan",
    role: "fan",
    identities: { youtube: "UCFAN" }
  });
  const harness = createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "Same character for fans and developers.",
      voiceStyle: "short"
    },
    projectOs: createInMemoryProjectOs(),
    userRegistry,
    router: createHeuristicRouter(),
    brains: {
      voice: createNamedBrain("voice-fast", "voice"),
      text: createNamedBrain("text-standard", "text")
    }
  });

  const result = await harness.receive({
    source: "youtube",
    modality: "text",
    text: "設計について深い議論をしたい",
    actor: {
      platform: "youtube",
      platformUserId: "UCFAN",
      displayName: "Fan"
    }
  });

  assert.equal(result.kind, "permission_denied");
  assert.equal(result.permission.permission, "deep_discussion");
  assert.equal(result.audience.tier, "public");
  assert.equal(result.audience.canDeepDiscuss, false);
  assert.equal(result.audience.identityStable, true);
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
      text: createNamedBrain("text-standard", "text")
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
    id: "text-http",
    endpoint: "http://brain.local/respond",
    model: "text-model",
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
    audience: { responseDepth: "standard", permissions: ["deep_discussion"] },
    input: { text: "設計相談" },
    route: { kind: "text" },
    state: { mode: "thinking" },
    projectOs: { tickets: [] }
  });

  assert.equal(response.text, "HTTP brain response");
  assert.equal(response.emotion, "focused");
  assert.equal(calls[0].model, "text-model");
  assert.equal(calls[0].audience.responseDepth, "standard");
  assert.equal(calls[0].route.kind, "text");
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
  assert.equal(snapshot.tickets[0].metadata.permissionCheck.allowed, true);
  assert.equal(snapshot.tickets[0].metadata.permissionCheck.permission, "delegate_work");
  assert.equal(
    snapshot.tickets[0].metadata.permissionCheck.actorPermissions.includes("delegate_work"),
    true
  );
  assert.equal(snapshot.runs.length, 1);
  assert.equal(snapshot.runs[0].status, "completed");
  assert.equal(snapshot.runs[0].input.permissionCheck.allowed, true);
  assert.equal(recorder.events().some((event) => event.type === "task"), true);
});

test("public fan cannot delegate work or create PJOS tickets", async () => {
  const userRegistry = createInMemoryUserRegistry();
  userRegistry.registerUser({
    id: "fan_1",
    displayName: "Fan",
    role: "fan",
    identities: { youtube: "UCFAN" }
  });
  const projectOs = createInMemoryProjectOs();
  const harness = createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "Same character, different permissions.",
      voiceStyle: "short"
    },
    projectOs,
    userRegistry,
    router: createHeuristicRouter(),
    brains: {
      voice: createNamedBrain("voice-fast", "voice"),
      text: createNamedBrain("text-standard", "text")
    },
    microHarnesses: [createStubMicroHarness("codex", ["code"])]
  });

  const result = await harness.receive({
    source: "youtube",
    modality: "text",
    text: "Codexで非公開リポジトリを読んで修正して",
    actor: {
      platform: "youtube",
      platformUserId: "UCFAN",
      displayName: "Fan"
    }
  });

  assert.equal(result.kind, "permission_denied");
  assert.equal(result.permission.permission, "delegate_work");
  assert.equal(result.audience.tier, "public");
  assert.equal(projectOs.snapshot().tickets.length, 0);
  assert.equal(projectOs.snapshot().runs.length, 0);
});

test("moderators can run stream operations through the stream controller", async () => {
  const projectOs = createInMemoryProjectOs();
  const userRegistry = createInMemoryUserRegistry();
  userRegistry.registerUser({
    id: "mod_1",
    displayName: "Moderator",
    role: "moderator",
    identities: { youtube: "UCMOD" }
  });
  const recorder = createRecorderDevice("recorder");
  const streamController = createRecorderStreamController("stream-recorder");
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
      text: createEchoBrain("text-standard")
    },
    devices: [recorder],
    streamController
  });

  const result = await harness.receive({
    source: "youtube",
    modality: "text",
    text: "OBSのシーンを配信用に変えて",
    metadata: {
      streamSessionId: "stream_1"
    },
    actor: {
      platform: "youtube",
      platformUserId: "UCMOD",
      displayName: "Moderator"
    }
  });

  assert.equal(result.kind, "stream_operation");
  assert.equal(result.route.kind, "stream");
  assert.equal(result.output.status, "completed");
  assert.equal(streamController.actions().length, 1);
  assert.equal(streamController.actions()[0].streamSessionId, "stream_1");
  assert.equal(recorder.events().some((event) => event.type === "stream"), true);
});

test("fans cannot run stream operations without manage_stream permission", async () => {
  const userRegistry = createInMemoryUserRegistry();
  userRegistry.registerUser({
    id: "fan_1",
    displayName: "Fan",
    role: "fan",
    identities: { youtube: "UCFAN" }
  });
  const streamController = createRecorderStreamController("stream-recorder");
  const harness = createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "Owns macro state.",
      voiceStyle: "short"
    },
    projectOs: createInMemoryProjectOs(),
    userRegistry,
    router: createHeuristicRouter(),
    brains: {
      voice: createEchoBrain("voice-fast"),
      text: createEchoBrain("text-standard")
    },
    streamController
  });

  const result = await harness.receive({
    source: "youtube",
    modality: "text",
    text: "OBSのシーンを変えて",
    actor: {
      platform: "youtube",
      platformUserId: "UCFAN",
      displayName: "Fan"
    }
  });

  assert.equal(result.kind, "permission_denied");
  assert.equal(result.permission.permission, "manage_stream");
  assert.equal(streamController.actions().length, 0);
});
