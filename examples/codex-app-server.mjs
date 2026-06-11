import { join } from "node:path";

import {
  createEchoBrain,
  createFileProjectOs,
  createFileUserRegistry,
  createHeuristicRouter,
  createIroHarness
} from "../src/index.js";
import { createCodexAppServerMicroHarness } from "../src/adapters/index.js";

if (process.env.IROHARNESS_RUN_CODEX !== "1") {
  console.error("Set IROHARNESS_RUN_CODEX=1 to run the Codex app-server example.");
  process.exit(1);
}

const workspace = process.env.CODEX_WORKSPACE || process.cwd();
const projectOs = createFileProjectOs({
  path: join(process.cwd(), ".iroharness", "codex-pjos.json")
});
const userRegistry = createFileUserRegistry({
  path: join(process.cwd(), ".iroharness", "users.json")
});

userRegistry.registerUser({
  id: "local-developer",
  displayName: "Local Developer",
  role: "developer",
  identities: { cli: "local-developer" },
  relationship: "developer"
});

const harness = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "A character macro harness that delegates coding work to Codex.",
    voiceStyle: "short"
  },
  projectOs,
  userRegistry,
  router: createHeuristicRouter(),
  brains: {
    voice: createEchoBrain("voice-fast"),
    text: createEchoBrain("text-standard")
  },
  microHarnesses: [
    createCodexAppServerMicroHarness({
      cwd: workspace,
      model: process.env.CODEX_MODEL || "gpt-5.4"
    })
  ]
});

const text = process.argv.slice(2).join(" ") || "Codexでこのリポジトリを短くレビューして";
const result = await harness.receive({
  source: "cli",
  modality: "text",
  text,
  actor: {
    platform: "cli",
    platformUserId: "local-developer",
    displayName: "Local Developer"
  }
});

console.log(JSON.stringify(result, null, 2));
