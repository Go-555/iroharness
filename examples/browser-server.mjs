import { join } from "node:path";

import {
  createEchoBrain,
  createFileProjectOs,
  createFileUserRegistry,
  createHeuristicRouter,
  createHttpBrain,
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

const brainAuthHeaders = () =>
  process.env.IROHARNESS_BRAIN_AUTH_TOKEN
    ? { authorization: `Bearer ${process.env.IROHARNESS_BRAIN_AUTH_TOKEN}` }
    : {};

const brainSlotEnv = Object.freeze({
  voice: {
    endpoint: "IROHARNESS_VOICE_BRAIN_ENDPOINT",
    model: "IROHARNESS_VOICE_BRAIN_MODEL",
    id: "IROHARNESS_VOICE_BRAIN_ID"
  },
  text: {
    endpoint: "IROHARNESS_TEXT_BRAIN_ENDPOINT",
    model: "IROHARNESS_TEXT_BRAIN_MODEL",
    id: "IROHARNESS_TEXT_BRAIN_ID"
  }
});

const createConfiguredBrain = ({ slot, fallbackId }) => {
  const env = brainSlotEnv[slot];
  const endpoint = process.env[env.endpoint];
  if (!endpoint) {
    return createEchoBrain(fallbackId);
  }
  return createHttpBrain({
    id: process.env[env.id] || `${slot}-http`,
    endpoint,
    model: process.env[env.model] || null,
    headers: brainAuthHeaders()
  });
};

const voiceBrain = createConfiguredBrain({
  slot: "voice",
  fallbackId: "voice-fast"
});
const textBrain = createConfiguredBrain({
  slot: "text",
  fallbackId: "text-standard"
});
const brains = Object.freeze({
  voice: voiceBrain,
  text: textBrain
});

userRegistry.registerUser({
  id: "owner-local",
  displayName: "Local Developer",
  role: "developer",
  identities: {
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
  brains,
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
console.log(`IroHarness brains: voice=${voiceBrain.id} text=${textBrain.id}`);
