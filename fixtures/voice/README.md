# Voice fixtures — Silero VAD parity

No audio binaries ship in this directory. It documents how to generate
parity fixtures for `src/voice-pipeline/silero-vad.js` against the Python
reference detector, and how to run the optional real-model smoke test.

## Real-model smoke test

`test/voice-silero-vad.test.js` contains an integration test that is skipped
unless `IROHARNESS_SILERO_MODEL` points at a Silero VAD ONNX model:

```bash
npm install onnxruntime-node   # optional dependency — consumers opt in
# model: https://github.com/snakers4/silero-vad (src/silero_vad/data/silero_vad.onnx)
IROHARNESS_SILERO_MODEL=/path/to/silero_vad.onnx npm test
```

## Generating parity fixtures (Python reference)

The JS state machine mirrors AIAvatarKit's `SileroStreamSpeechDetector`.
To produce reference probabilities / segment boundaries with the same model:

1. Create a venv and install AIAvatarKit:

   ```bash
   python3 -m venv .venv && source .venv/bin/activate
   pip install aiavatar
   ```

2. Use `examples/aiavatar-silero-stt-worker.py` as the reference harness —
   it wires `SileroStreamSpeechDetector` with the same threshold / silence
   duration semantics (512-sample frames @ 16 kHz, int16 → float32 by /32768).

3. Feed a known 16 kHz mono PCM16 WAV through the detector, record per-frame
   probabilities and emitted segment boundaries (start/end sample offsets),
   and save them as JSON next to this README (e.g. `parity-<clip>.json`).

4. A future integration test can replay the same WAV through
   `createSileroVad` + `loadSileroSession` and assert matching boundaries.
   Keep it gated by `IROHARNESS_SILERO_MODEL` so CI stays model-free.

Determinism note: the JS detector measures `minSpeechMs` / `silenceMs` on a
sample-count clock (audio time, not wall time), matching the Python detector.
