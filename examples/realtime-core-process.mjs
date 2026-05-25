import {
  createRealtimeVoiceSession,
  createTextStreamingStt,
  createTextStreamingTts
} from "../src/index.js";
import { createJsonlRealtimeCoreProcess } from "../src/adapters/index.js";

const core = createJsonlRealtimeCoreProcess({
  id: "realtime-core-process-demo",
  command: process.execPath,
  args: [new URL("./realtime-core-worker.mjs", import.meta.url).pathname],
  onMessage(message) {
    console.log("core:", message);
  }
});

let session = null;
session = createRealtimeVoiceSession({
  stt: createTextStreamingStt({ id: "demo-stt" }),
  tts: createTextStreamingTts({ id: "demo-tts", chunkSize: 4 }),
  realtimeCore: core,
  onEvent(event) {
    if (event.type === "tts.audio") {
      session.handleSttEvent({
        type: "stt.partial",
        text: "待って",
        delta: "待って",
        final: false
      });
    }
  }
});

session.listen().push("こんにちは");
await session.speak({
  text: "IroHarness can delegate realtime core work to a JSONL process.",
  voice: "iroha"
});

await new Promise((resolve) => setTimeout(resolve, 100));
console.log(JSON.stringify(core.snapshot(), null, 2));
core.close();
