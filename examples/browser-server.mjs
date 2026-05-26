import { join } from "node:path";

import {
  createEchoBrain,
  createFileProjectOs,
  createFileUserRegistry,
  createHeuristicRouter,
  createIroHarness,
  createStubMicroHarness
} from "../src/index.js";
import {
  createEventStreamDevice,
  createEvenG2DisplayBridge,
  createIroHarnessDevServer,
  createLive2DBodyBridge,
  createM5StackBodyBridge,
  createMotionPngTuberRendererBridge,
  createVrmBodyBridge
} from "../src/adapters/index.js";

const eventStream = createEventStreamDevice("browser-events");
const bodyDevices = [
  createMotionPngTuberRendererBridge(),
  createM5StackBodyBridge(),
  createEvenG2DisplayBridge(),
  createLive2DBodyBridge(),
  createVrmBodyBridge()
];
const projectOs = createFileProjectOs({
  path: join(process.cwd(), ".iroharness", "browser-pjos.json")
});
const userRegistry = createFileUserRegistry({
  path: join(process.cwd(), ".iroharness", "users.json")
});

userRegistry.registerUser({
  id: "owner-local",
  displayName: "Local Developer",
  role: "developer",
  identities: {
    browser: "browser-guest",
    discord: "discord-developer",
    youtube: "youtube-developer"
  },
  relationship: "developer"
});

const harness = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "Owns the character macro harness and routes work to micro harnesses.",
    voiceStyle: "short, natural, responsive"
  },
  projectOs,
  userRegistry,
  router: createHeuristicRouter(),
  brains: {
    voice: createEchoBrain("voice-fast"),
    text: createEchoBrain("text-deep")
  },
  devices: [eventStream, ...bodyDevices],
  microHarnesses: [
    createStubMicroHarness("codex", ["code", "files", "review"]),
    createStubMicroHarness("openclaw", ["assistant", "tools"]),
    createStubMicroHarness("hermes", ["learning", "skills"])
  ]
});

const app = createIroHarnessDevServer({
  harness,
  userRegistry,
  adminToken: process.env.IROHARNESS_ADMIN_TOKEN || null,
  eventStream,
  bodyDevices
});

const { url } = await app.listen({
  port: Number(process.env.PORT || 4178)
});

console.log(`IroHarness browser avatar: ${url}`);
console.log(`IroHarness audience admin: ${url}/?view=admin`);
