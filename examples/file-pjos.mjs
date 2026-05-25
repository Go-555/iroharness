import { join } from "node:path";

import {
  createEchoBrain,
  createFileProjectOs,
  createFileUserRegistry,
  createHeuristicRouter,
  createIroHarness,
  createProjectOsMarkdown,
  createStubMicroHarness
} from "../src/index.js";

const projectOs = createFileProjectOs({
  path: join(process.cwd(), ".iroharness", "pjos.json")
});
const userRegistry = createFileUserRegistry({
  path: join(process.cwd(), ".iroharness", "users.json")
});

userRegistry.registerUser({
  id: "cli-developer",
  displayName: "CLI Developer",
  role: "developer",
  identities: { cli: "local-dev" }
});

const iroha = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "Owns durable macro state.",
    voiceStyle: "short"
  },
  projectOs,
  userRegistry,
  router: createHeuristicRouter(),
  brains: {
    voice: createEchoBrain("voice-fast"),
    text: createEchoBrain("text-deep")
  },
  microHarnesses: [
    createStubMicroHarness("codex", ["code", "files", "review"])
  ]
});

await iroha.receive({
  source: "cli",
  modality: "text",
  text: "CodexでPJOSの使い方を確認して",
  actor: {
    platform: "cli",
    platformUserId: "local-dev",
    displayName: "CLI Developer"
  }
});

console.log(createProjectOsMarkdown(projectOs.snapshot()));
