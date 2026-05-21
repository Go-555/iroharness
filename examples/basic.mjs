import {
  createConsoleDevice,
  createEchoBrain,
  createHeuristicRouter,
  createInMemoryProjectOs,
  createIroHarness,
  createStubMicroHarness
} from "../src/index.js";

const projectOs = createInMemoryProjectOs();

const iroha = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "A practical character companion who owns the macro harness.",
    voiceStyle: "short, natural, responsive"
  },
  projectOs,
  router: createHeuristicRouter(),
  brains: {
    voice: createEchoBrain("voice-fast"),
    text: createEchoBrain("text-deep")
  },
  devices: [createConsoleDevice("console")],
  microHarnesses: [createStubMicroHarness("codex", ["code", "files", "review"])]
});

await iroha.receive({
  source: "web",
  modality: "voice",
  text: "こんにちは"
});

await iroha.receive({
  source: "web",
  modality: "text",
  text: "CodexでREADMEの実装方針をレビューして"
});

console.log(JSON.stringify(iroha.projectOs(), null, 2));
