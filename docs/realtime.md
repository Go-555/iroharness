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

## Why This Is A Contract First

Remote STT, LLM, and TTS providers dominate latency. Rust will not make a remote
model think faster, but it can reduce overhead around VAD, interruption,
WebSocket fanout, device sync, and audio chunk scheduling. These contracts keep
the macro harness stable while the underlying realtime engine can move from
Node.js prototypes to a Rust audio/device/event core later.
