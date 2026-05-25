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
  createSnapshotStreamSessionResolver,
  createStreamContextEnricher,
  createYouTubeLiveChatPollingRuntime
} from "../src/adapters/index.js";

const apiKey = process.env.YOUTUBE_API_KEY;
const liveChatId = process.env.YOUTUBE_LIVE_CHAT_ID;

if (!apiKey || !liveChatId) {
  console.error("Set YOUTUBE_API_KEY and YOUTUBE_LIVE_CHAT_ID.");
  process.exit(1);
}

const projectOs = createFileProjectOs({
  path: join(process.cwd(), ".iroharness", "youtube-pjos.json")
});
const userRegistry = createFileUserRegistry({
  path: join(process.cwd(), ".iroharness", "users.json")
});
userRegistry.createStreamSession({
  id: `youtube_${liveChatId}`,
  platform: "youtube",
  platformChannelId: liveChatId,
  title: process.env.YOUTUBE_STREAM_TITLE || "IroHarness YouTube Live",
  status: "live"
});
const enrichTurn = createStreamContextEnricher({
  resolveStreamSession: createSnapshotStreamSessionResolver({
    snapshot: () => userRegistry.snapshot()
  })
});

const harness = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "A stable character macro harness for YouTube live chat.",
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

const runtime = createYouTubeLiveChatPollingRuntime({
  apiKey,
  liveChatId,
  harness,
  turnEnricher: enrichTurn,
  onResult({ turn, result }) {
    console.log(
      JSON.stringify({
        from: turn.actor.displayName,
        text: turn.text,
        streamSessionId: turn.metadata.streamSessionId,
        resultKind: result.kind
      })
    );
  },
  onError(error) {
    console.error(error.message);
  }
});

runtime.start();
console.log("IroHarness YouTube live chat poller started.");

process.on("SIGINT", () => {
  runtime.stop();
  process.exit(0);
});
