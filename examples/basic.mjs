import {
  createConsoleDevice,
  createEchoBrain,
  createHeuristicRouter,
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
  createStubMicroHarness
} from "../src/index.js";

const projectOs = createInMemoryProjectOs();
const userRegistry = createInMemoryUserRegistry();
userRegistry.registerUser({
  id: "local-developer",
  displayName: "Local Developer",
  role: "developer",
  identities: { web: "local-dev" }
});

const iroha = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "A practical character companion who owns the macro harness.",
    voiceStyle: "short, natural, responsive"
  },
  projectOs,
  userRegistry,
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
  text: "こんにちは",
  actor: {
    platform: "web",
    platformUserId: "local-dev",
    displayName: "Local Developer"
  }
});

await iroha.receive({
  source: "web",
  modality: "text",
  text: "CodexでREADMEの実装方針をレビューして",
  actor: {
    platform: "web",
    platformUserId: "local-dev",
    displayName: "Local Developer"
  }
});

console.log(JSON.stringify(iroha.projectOs(), null, 2));
