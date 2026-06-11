import assert from "node:assert/strict";
import test from "node:test";
import { resamplePcm16 } from "../src/voice-pipeline/resampler.js";

test("downsamples 2:1 by linear interpolation", () => {
  const src = Int16Array.from([0, 100, 200, 300]);
  const out = resamplePcm16(src, 32000, 16000);
  assert.deepEqual(Array.from(out), [0, 200]);
});

test("same rate returns same samples", () => {
  const src = Int16Array.from([1, 2, 3]);
  assert.deepEqual(Array.from(resamplePcm16(src, 16000, 16000)), [1, 2, 3]);
});

test("upsamples 1:2 and doubles length", () => {
  const src = Int16Array.from([0, 100, 200]);
  const out = resamplePcm16(src, 16000, 32000);
  assert.deepEqual(Array.from(out), [0, 50, 100, 150, 200, 200]);
});

test("int16 extremes stay within range when resampling", () => {
  const src = Int16Array.from([-32768, 32767]);
  const out = resamplePcm16(src, 48000, 44100);
  assert.ok(out.length > 0);
  for (const value of out) {
    assert.ok(
      value >= -32768 && value <= 32767,
      `sample out of int16 range: ${value}`,
    );
  }
});

test("empty input returns empty output", () => {
  const src = Int16Array.from([]);
  const out = resamplePcm16(src, 16000, 24000);
  assert.equal(out.length, 0);
});
