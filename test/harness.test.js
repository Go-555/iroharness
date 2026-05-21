import assert from "node:assert/strict";
import test from "node:test";

import {
  createEchoBrain,
  createHeuristicRouter,
  createInMemoryProjectOs,
  createIroHarness,
  createRecorderDevice,
  createStubMicroHarness
} from "../src/index.js";

const createHarness = () => {
  const projectOs = createInMemoryProjectOs();
  const recorder = createRecorderDevice("recorder");
  const harness = createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "Owns macro state.",
      voiceStyle: "short"
    },
    projectOs,
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

test("work input delegates to a micro harness and records ticket/run state", async () => {
  const { harness, recorder } = createHarness();
  const result = await harness.receive({
    source: "slack",
    modality: "text",
    text: "Codexでこのコードをレビューして"
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
