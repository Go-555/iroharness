import {
  createEchoBrain,
  createHeuristicRouter,
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness
} from "../src/index.js";

const createDemoBrain = (id, label) =>
  Object.freeze({
    id,
    async respond({ character, input }) {
      return {
        text: `${character.name}/${label}: ${input.text}`,
        emotion: "attentive"
      };
    }
  });

const userRegistry = createInMemoryUserRegistry();
userRegistry.registerUser({
  id: "developer",
  displayName: "Developer",
  role: "developer",
  identities: {
    cli: "developer"
  }
});

const harness = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "Owns identity while switching brains by mode.",
    voiceStyle: "short"
  },
  projectOs: createInMemoryProjectOs(),
  userRegistry,
  router: createHeuristicRouter(),
  brains: {
    voice: createDemoBrain("voice-fast", "voice"),
    text: createEchoBrain("text-standard")
  }
});

const actor = {
  platform: "cli",
  platformUserId: "developer",
  displayName: "Developer"
};

const inputs = [
  { source: "cli", modality: "voice", text: "設計について話そう", actor },
  { source: "cli", modality: "text", text: "こんにちは", actor },
  { source: "cli", modality: "text", text: "このアーキテクチャ設計について深い議論をしたい", actor }
];

for (const input of inputs) {
  const result = await harness.receive(input);
  console.log(
    JSON.stringify({
      text: input.text,
      route: result.route.kind,
      brainId: result.brainId,
      response: result.text
    })
  );
}
