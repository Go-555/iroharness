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
  createSlackEventsRuntime,
  createSlackMessageAdapter
} from "../src/adapters/index.js";

const botToken = process.env.SLACK_BOT_TOKEN;

if (!botToken) {
  console.error("Set SLACK_BOT_TOKEN.");
  process.exit(1);
}

const projectOs = createFileProjectOs({
  path: join(process.cwd(), ".iroharness", "slack-pjos.json")
});
const userRegistry = createFileUserRegistry({
  path: join(process.cwd(), ".iroharness", "users.json")
});

const harness = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "A stable character macro harness for Slack teams.",
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

const runtime = createSlackEventsRuntime({
  botToken,
  harness,
  adapter: createSlackMessageAdapter({
    mentionOnly: process.env.SLACK_MENTION_ONLY !== "0",
    botUserId: process.env.SLACK_BOT_USER_ID || null
  }),
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

const samplePayload = {
  type: "event_callback",
  team_id: "TLOCAL",
  event: {
    type: "app_mention",
    user: "ULOCAL",
    channel: "CLOCAL",
    ts: new Date().getTime().toString(),
    text: `${process.env.SLACK_BOT_USER_ID ? `<@${process.env.SLACK_BOT_USER_ID}> ` : ""}こんにちは`,
    user_profile: {
      display_name: "Local Developer"
    }
  }
};

const result = await runtime.handlePayload(samplePayload);
console.log(JSON.stringify({ handled: result.turn?.source || result.kind }));
