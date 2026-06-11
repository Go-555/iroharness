# AIAvatarKit Conversation Pipeline — IroHarness Parity Table

This table cross-references AIAvatarKit's server-side conversation pipeline
features with their IroHarness counterparts and the test(s) that pin each
behaviour. All test names are verbatim from the source files listed.

Reference: <https://github.com/uezo/AIAvatarKit>

## Parity Table

| AIAvatarKit feature | IroHarness implementation | Source | Test(s) |
|---|---|---|---|
| **VAD — Silero stream detector** | `createSileroVad` — ONNX-based VAD with pre-roll ring, `speech.start` / `speech.end` segment events, and mock fallback | `src/voice-pipeline/silero-vad.js` | "scripted speech emits exactly one speech.start and one speech.end with pre-roll and trailing audio" (`voice-silero-vad.test.js:44`); "maxSpeechMs caps a segment and the machine can start a new one" (`:129`); "loadSileroSession with failing importFn mentions onnxruntime-node" (`:203`) |
| **STT — speech-to-text** | Mock STT (`IROHARNESS_STACKCHAN_STT_PROVIDER=mock`), HTTP STT adapter (`createHttpStreamingStt`), Azure Speech (`createAzureSpeechStt`) | `src/adapters/index.js`, `src/voice-pipeline/` | "Azure Speech STT adapter posts buffered audio and emits final transcript" (`adapters.test.js:465`); "StackChan realtime session handler accepts firmware audio and returns speech" (`:658`) |
| **Streaming LLM with sentence split** | `toBrainStream` wraps `respondStream` async iterator; `createSentenceSplitter` splits on Japanese/EN terminal punctuation with a comma-flush threshold | `src/voice-pipeline/brain-stream.js`, `src/voice-pipeline/sentence-splitter.js` | "speaks the first sentence before the brain releases its second delta" (`voice-pipeline.test.js:226`); "splits on Japanese terminal punctuation" (`voice-sentence-splitter.test.js:5`); "splits long clause on comma past threshold (terminal char absent)" (`:12`) |
| **Per-sentence TTS** | Each sentence yielded by `createSentenceSplitter` is immediately passed to `tts.stream()`; audio events are forwarded as `speech.audio` pipeline events | `src/voice-pipeline/` | "a tts failure on one sentence is reported and the next sentence still speaks" (`voice-pipeline.test.js:327`); "whitespace-only sentences are skipped, never sent to tts" (`:364`) |
| **Playback pacing** | `createVoicePacer` sleeps `byteLength / 2 / (sampleRate / 1000)` ms per sentence so the pipeline does not flood the firmware's playback buffer | `src/voice-pipeline/pacer.js` | "paces each sentence by the base64 byte-length/2 approximation before emitting" (`voice-pipeline.test.js:588`); "does not sleep while within lead" (`voice-pacer.test.js:16`); "sleeps the excess beyond lead when sending a burst" (`:23`) |
| **Barge-in — manual** | `pipeline.interrupt("manual")` aborts the active TTS stream and emits `speech.interrupted`; `session.handlePipelineEvent` maps device `interrupt` / `stop` messages to `pipeline.interrupt("device-interrupt")` | `src/voice-pipeline/`, `src/adapters/index.js` | "manual barge-in aborts tts, abandons the turn, and stops speech" (`voice-pipeline.test.js:281`); "StackChan realtime session handler streaming interrupt reaches the pipeline and the wire" (`adapters.test.js:1368`) |
| **Barge-in — auto (VAD)** | VAD emits `speech.start` while pipeline is speaking; pipeline self-interrupts via the barge-in handler | `src/voice-pipeline/` | "auto barge-in: speech.start while speaking aborts the running turn" (`voice-pipeline.test.js:305`) |
| **Quick response / ack** | `createQuickResponder` pre-warms a TTS phrase and fires it as the first `speech.audio` event before the brain returns a token; session handler emits a single `response.start` with `role: "ack"` | `src/voice-pipeline/quick-responder.js`, `src/adapters/index.js` | "StackChan realtime session handler speaks an immediate ack before brain completion" (`adapters.test.js:760`); "fire() before warmup returns null" (`voice-quick-responder.test.js:58`); "warmup with 2 phrases resolves to 2; fire() round-robins" (`:68`) |
| **Per-stage latency metrics** | `createVoiceTurnMetrics` records `stt_final_ms`, `brain_first_token_ms`, `tts_first_audio_ms`, `first_audio_total_ms`, and `total_ms` per turn; forwarded as `response.final.metrics` on the wire | `src/voice-pipeline/metrics.js`, `src/adapters/index.js` | "full happy turn records metrics and resets them after turn.final" (`voice-pipeline.test.js:550`); "metrics reset on new utterance: the turn after a barge-in gets clean marks" (`:515`); "StackChan realtime session handler streaming turn.final sends response.final with metrics" (`adapters.test.js:1392`) |
| **Max-speech cap** | `maxSentences` option in `createVoicePipeline` stops consumption, aborts the brain stream, and emits a `turn.final` when the cap is reached | `src/voice-pipeline/` | "maxSentences guard stops consumption, aborts the brain, and reports once" (`voice-pipeline.test.js:345`) |
| **Fallback on brain failure** | Brain errors and brain-inactivity timeout emit the fallback phrase and finish the turn; spoken sentences before the failure are preserved in `turn.final.text` | `src/voice-pipeline/` | "a brain that throws mid-turn keeps spoken sentences and speaks the fallback" (`voice-pipeline.test.js:430`); "brain inactivity timeout trips the fallback but keeps spoken sentences" (`:451`) |

## Non-Goals (Deferred)

The following AIAvatarKit features are deliberately out of scope for IroHarness
in the current release:

| Feature | Reason |
|---|---|
| Wakeword detection | Firmware-local concern; stays in the PlatformIO runtime. |
| Speaker recognition / diarization | Separate privacy-sensitive capability; deferred. |
| Conversation recording | Out of scope for the macro harness core; can be added as a body adapter. |
| Dynamic config API (hot-reload of TTS/STT/LLM at runtime) | IroHarness config is restart-based; deferred until a config hot-reload contract is designed. |
