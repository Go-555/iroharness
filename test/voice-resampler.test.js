import assert from "node:assert/strict";
import test from "node:test";
import { resamplePcm16 } from "../src/voice-pipeline/resampler.js";

test("downsamples 2:1 by linear interpolation", () => {
  const src = Int16Array.from([0, 100, 200, 300]);
  const out = resamplePcm16(src, 32000, 16000);
  assert.equal(out.length, 2);
  assert.equal(out[0], 0);
});

test("same rate returns same samples", () => {
  const src = Int16Array.from([1, 2, 3]);
  assert.deepEqual(Array.from(resamplePcm16(src, 16000, 16000)), [1, 2, 3]);
});

test("upsamples 1:2 and doubles length", () => {
  const src = Int16Array.from([0, 100, 200]);
  const out = resamplePcm16(src, 16000, 32000);
  assert.ok(
    out.length >= 5 && out.length <= 7,
    `expected ~6, got ${out.length}`,
  );
});

test("empty input returns empty output", () => {
  const src = Int16Array.from([]);
  const out = resamplePcm16(src, 16000, 24000);
  assert.equal(out.length, 0);
});
