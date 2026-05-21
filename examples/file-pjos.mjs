import { join } from "node:path";

import {
  createEchoBrain,
  createFileProjectOs,
  createHeuristicRouter,
  createIroHarness,
  createProjectOsMarkdown,
  createStubMicroHarness
} from "../src/index.js";

const projectOs = createFileProjectOs({
  path: join(process.cwd(), ".iroharness", "pjos.json")
});

const iroha = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "Owns durable macro state.",
    voiceStyle: "short"
  },
  projectOs,
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
  text: "CodexでPJOSの使い方を確認して"
});

console.log(createProjectOsMarkdown(projectOs.snapshot()));
