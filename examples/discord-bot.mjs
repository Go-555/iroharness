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
  createDiscordBotRuntime,
  createDiscordMessageAdapter
} from "../src/adapters/index.js";

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error("Set DISCORD_BOT_TOKEN.");
  process.exit(1);
}

const projectOs = createFileProjectOs({
  path: join(process.cwd(), ".iroharness", "discord-pjos.json")
});
const userRegistry = createFileUserRegistry({
  path: join(process.cwd(), ".iroharness", "users.json")
});

const harness = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "A stable character macro harness for Discord communities.",
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
    createStubMicroHarness("codex", ["code", "files", "review"])
  ]
});

const runtime = createDiscordBotRuntime({
  token,
  harness,
  adapter: createDiscordMessageAdapter({
    mentionOnly: process.env.DISCORD_MENTION_ONLY !== "0",
    botUserId: process.env.DISCORD_BOT_USER_ID || null
  }),
  onReady({ botUserId, sessionId }) {
    console.log(`IroHarness Discord bot ready: ${botUserId} ${sessionId}`);
  },
  onResult({ turn, result, reply }) {
    console.log(
      JSON.stringify({
        from: turn.actor.displayName,
        text: turn.text,
        resultKind: result.kind,
        replied: Boolean(reply)
      })
    );
  },
  onError(error) {
    console.error(error.message);
  }
});

runtime.start();

process.on("SIGINT", () => {
  runtime.stop();
  process.exit(0);
});
