import { join } from "node:path";

import {
  createEchoBrain,
  createFileProjectOs,
  createHeuristicRouter,
  createIroHarness,
  createStubMicroHarness
} from "../src/index.js";
import {
  createEventStreamDevice,
  createIroHarnessDevServer
} from "../src/adapters/index.js";

const eventStream = createEventStreamDevice("browser-events");
const projectOs = createFileProjectOs({
  path: join(process.cwd(), ".iroharness", "browser-pjos.json")
});

const harness = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "Owns the character macro harness and routes work to micro harnesses.",
    voiceStyle: "short, natural, responsive"
  },
  projectOs,
  router: createHeuristicRouter(),
  brains: {
    voice: createEchoBrain("voice-fast"),
    text: createEchoBrain("text-deep")
  },
  devices: [eventStream],
  microHarnesses: [
    createStubMicroHarness("codex", ["code", "files", "review"]),
    createStubMicroHarness("openclaw", ["assistant", "tools"]),
    createStubMicroHarness("hermes", ["learning", "skills"])
  ]
});

const app = createIroHarnessDevServer({
  harness,
  eventStream
});

const { url } = await app.listen({
  port: Number(process.env.PORT || 4178)
});

console.log(`IroHarness browser avatar: ${url}`);
