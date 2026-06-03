# Realtime Voice Core

IroHarness keeps the character identity in the macro harness while realtime
audio components stay replaceable.

```text
audio in
  -> streaming STT
  -> voice brain / text brain / micro harness
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

For production providers, use the HTTP adapter shape and put the actual OpenAI,
local Whisper, browser relay, or vendor-specific code behind an HTTP endpoint:

```js
import { createHttpStreamingStt } from "iroharness";

const stt = createHttpStreamingStt({
  endpoint: "http://127.0.0.1:8788/stt"
});
```

The endpoint receives `{ type, audio, text, final }` and can return either
`{ events: [...] }` or `{ text, delta, final }`.

For Azure Speech, use the provider adapter from `iroharness/adapters`:

```js
import { createAzureSpeechStt } from "iroharness/adapters";

const stt = createAzureSpeechStt({
  region: "japaneast",
  subscriptionKey: process.env.AZURE_SPEECH_KEY,
  language: "ja-JP"
});
```

This adapter targets Azure Speech's short-audio REST path. It is useful for PTT
and recorded device audio. For always-on sub-second streaming, keep the
StackChan/WebSocket path open and replace this with a continuous streaming STT
provider behind the same STT event contract.

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

For production providers, use the HTTP TTS adapter:

```js
import { createHttpStreamingTts } from "iroharness";

const tts = createHttpStreamingTts({
  endpoint: "http://127.0.0.1:8788/tts"
});
```

The endpoint receives `{ text, voice }` and can return `{ events: [...] }`,
`{ chunks: [{ text, audio }] }`, or `{ audio }`.

For AivisSpeech Engine, use the VOICEVOX-compatible adapter:

```js
import { createAivisSpeechTts } from "iroharness/adapters";

const tts = createAivisSpeechTts({
  baseUrl: "http://127.0.0.1:10101",
  speaker: process.env.AIVIS_SPEECH_SPEAKER
});
```

The adapter calls `/audio_query` and then `/synthesis`, returning WAV audio as
base64 `tts.audio` events. If AivisSpeech Engine is launched with cancellable
synthesis enabled, set `useCancellableSynthesis: true`.

## Speech Playback Queue

`createSpeechPlaybackQueue` is the body-side playback contract. It lets
StackChan, MotionPNGTuber, Live2D, VRM, and browser pets consume the same speech
events without each body inventing its own queue semantics.

```js
import { createSpeechPlaybackQueue } from "iroharness";

const queue = createSpeechPlaybackQueue({
  onEvent(event) {
    console.log(event.type, event.item?.text);
  }
});

const item = queue.enqueue({
  text: "こんにちは。作業を進めるね。",
  audio: "base64-audio",
  voice: "iroha",
  source: "voice-brain"
});

queue.complete(item.id);
```

Queue event types:

- `speech.queued`
- `speech.started`
- `speech.completed`
- `speech.interrupted`
- `speech.cleared`

Use `enqueue(item, { mode: "replace" })` when the body should stop the current
utterance and speak the new item immediately. Use `interrupt("barge-in")` when
STT detects that the user started talking over the character.

## StackChan Low-Latency Relay

IroHarness exposes two StackChan realtime pieces in `iroharness/adapters`:

- `createStackChanRealtimeRelay`: client-side relay/simulator that connects out
  to a WebSocket endpoint
- `createStackChanRealtimeSessionHandler`: server-side session handler for a
  firmware-facing WebSocket connection

```js
import {
  createAivisSpeechTts,
  createAzureSpeechStt,
  createStackChanRealtimeSessionHandler
} from "iroharness/adapters";

const handler = createStackChanRealtimeSessionHandler({
  harness,
  stt: createAzureSpeechStt({ region: "japaneast", subscriptionKey: process.env.AZURE_SPEECH_KEY }),
  tts: createAivisSpeechTts({ speaker: process.env.AIVIS_SPEECH_SPEAKER }),
  deviceToken: process.env.STACKCHAN_DEVICE_TOKEN
});

// Pass a WebSocket object from your server framework.
handler.handleConnection(socket, {
  deviceId: "stackchan",
  token: requestToken
});
```

The session handler accepts both IroHarness realtime messages and
AIAvatarStackChan-style WebSocket messages.

IroHarness-native clients can send `hello`, `audio.chunk`, `ptt.audio`,
`invoke`, `vision`, `interrupt`, and `stop`, then receive `ready`, `stt.event`,
`response.start`, `speech.audio`, `response.final`, or `error`.

AIAvatarStackChan-style firmware can send `start`, `data`, `invoke`, and
`stop`, including `session_id`, `user_id`, `channel`, `audio_data`, and
`metadata.audio_format`. The same handler answers with `connected`, `accepted`,
`voiced`, `start`, `chunk`, `final`, `stop`, or `error`.
The message shape is documented in
`protocols/stackchan-realtime-message.schema.json`.

This is now enough to mount on a real WebSocket server and exercise the
AIAvatarStackChan-derived firmware path. The remaining work is real hardware
latency tuning and audio codec alignment before claiming a guaranteed 1-second
response.

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
  createRustRealtimeCoreCabiAdapter,
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

If a native addon or WebAssembly instance exposes the IroHarness Rust C ABI, use
it directly:

```js
const wasm = await WebAssembly.instantiate(bytes, {});
const realtimeCore = createRustRealtimeCoreCabiAdapter({
  exports: wasm.instance.exports
});
```

The C ABI path is synchronous, so barge-in decisions can stay in the realtime
loop while model, memory, and permission policy stay in the macro harness.

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

The JSONL protocol is described by:

- [`protocols/realtime-core-command.schema.json`](../protocols/realtime-core-command.schema.json)
- [`protocols/realtime-core-message.schema.json`](../protocols/realtime-core-message.schema.json)

## Why This Is A Contract First

Remote STT, LLM, and TTS providers dominate latency. Rust will not make a remote
model think faster, but it can reduce overhead around VAD, interruption,
WebSocket fanout, device sync, and audio chunk scheduling. These contracts keep
the macro harness stable while the underlying realtime engine can move from
Node.js prototypes to a Rust audio/device/event core later.
