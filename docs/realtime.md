# Realtime Voice Core

IroHarness keeps the character identity in the macro harness while realtime
audio components stay replaceable.

```text
audio in
  -> streaming STT
  -> voice brain / text brain / deep brain / micro harness
  -> streaming TTS
  -> body + device output
```

## Streaming STT

`createTextStreamingStt` is a dependency-free contract implementation. It is not
a production speech recognizer. It defines how an STT adapter should emit
partial and final transcript events.

```js
import { createTextStreamingStt } from "iroharness";

const stt = createTextStreamingStt();
const session = stt.start({
  onEvent(event) {
    console.log(event.type, event.text);
  }
});

session.push("こん");
session.push("にちは");
session.end();
```

Event types:

- `stt.partial`
- `stt.final`
- `stt.cancelled`

## Streaming TTS

`createTextStreamingTts` emits chunk events and supports interruption through an
`AbortSignal`.

```js
import { createTextStreamingTts } from "iroharness";

const tts = createTextStreamingTts({ chunkSize: 24 });
const controller = new AbortController();

await tts.stream({
  text: "こんにちは。作業を進めるね。",
  voice: "iroha",
  signal: controller.signal,
  onEvent(event) {
    console.log(event.type, event.audio);
  }
});
```

Event types:

- `tts.audio`
- `tts.completed`
- `tts.interrupted`

## Interruption / Barge-In

`createRealtimeVoiceSession` wires STT, TTS, and latency tracking together. If a
partial STT event arrives while TTS is speaking, the session aborts active TTS
and emits `realtime.barge_in`.

```js
import {
  createRealtimeVoiceSession,
  createTextStreamingStt,
  createTextStreamingTts
} from "iroharness";

const session = createRealtimeVoiceSession({
  stt: createTextStreamingStt(),
  tts: createTextStreamingTts(),
  onEvent(event) {
    console.log(event.type);
  }
});

const listening = session.listen();
await session.speak({ text: "説明するね。", voice: "iroha" });

// Usually this is called by a real STT adapter when the user starts talking.
listening.push("待って");
```

Session event types:

- `realtime.listening`
- `realtime.speaking`
- `realtime.barge_in`
- `realtime.interrupted`
- `realtime.spoken`
- `realtime.closed`

## Latency Metrics

`createRealtimeLatencyTracker` records named marks and measures durations. Use it
to track the budget for sub-second replies.

```js
import { createRealtimeLatencyTracker } from "iroharness";

const latency = createRealtimeLatencyTracker();

latency.mark("audio.received");
latency.mark("stt.final");
latency.mark("llm.first_token");
latency.mark("tts.first_audio");

latency.measure("first_audio_ms", "audio.received", "tts.first_audio");
console.log(latency.snapshot());
```

## Realtime Core Binding

`createRealtimeVoiceSession` can publish the same event stream into a realtime
core. The core can be the dependency-free JavaScript implementation today, or a
Rust native/WASM/process implementation later.

```js
import {
  createJavascriptRealtimeCore,
  createRealtimeVoiceSession,
  createRustRealtimeCoreBinding
} from "iroharness";

const realtimeCore = createRustRealtimeCoreBinding({
  fallbackCore: createJavascriptRealtimeCore({ id: "iroha-realtime-core" })
});

const session = createRealtimeVoiceSession({
  realtimeCore
});
```

Core contract:

- `publish(event)` records or fans out realtime events
- `mark(name, at)` records latency marks
- `startSpeaking()` / `finishSpeaking()` update speech state
- `shouldInterrupt(event)` decides barge-in from STT events
- `snapshot()` returns events, latency, and core state

This keeps the macro harness API stable while the fast path underneath can move
to Rust incrementally.

## External JSONL Realtime Core

Use `createJsonlRealtimeCoreProcess` when the realtime core runs as a separate
process. That process can be Rust, Go, C++, Python, Node, or anything else that
can read and write newline-delimited JSON.

```js
import { createJsonlRealtimeCoreProcess } from "iroharness/adapters";

const realtimeCore = createJsonlRealtimeCoreProcess({
  command: "iroharness-realtime-core",
  args: ["--jsonl"]
});
```

IroHarness sends one JSON object per operation:

```json
{
  "op": "publish",
  "coreId": "jsonl-realtime-core",
  "sequence": 0,
  "timestamp": "2026-05-25T00:00:00.000Z",
  "event": {
    "type": "realtime.speaking"
  }
}
```

Supported operations:

- `publish`
- `mark`
- `measure`
- `startSpeaking`
- `finishSpeaking`
- `shouldInterrupt`

The adapter keeps local event, latency, and barge-in state so
`createRealtimeVoiceSession` still gets immediate synchronous decisions. The
external process receives the same stream and can do lower-latency audio,
device, WebSocket, or VAD work independently.

## Why This Is A Contract First

Remote STT, LLM, and TTS providers dominate latency. Rust will not make a remote
model think faster, but it can reduce overhead around VAD, interruption,
WebSocket fanout, device sync, and audio chunk scheduling. These contracts keep
the macro harness stable while the underlying realtime engine can move from
Node.js prototypes to a Rust audio/device/event core later.
