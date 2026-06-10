import assert from "node:assert/strict";
import test from "node:test";
import { createAudioPacer } from "../src/voice-pipeline/pacer.js";

const createFakeClock = () => {
  let now = 0;
  const sleeps = [];
  return {
    nowFn: () => now,
    sleepFn: async (ms) => { sleeps.push(ms); now += ms; },
    advance: (ms) => { now += ms; },
    sleeps
  };
};

test("does not sleep while within lead", async () => {
  const clock = createFakeClock();
  const pacer = createAudioPacer({ sampleRate: 16000, leadMs: 1500, nowFn: clock.nowFn, sleepFn: clock.sleepFn });
  await pacer.pace(16000); // 1000ms of audio, ahead by 1000ms < 1500ms lead
  assert.deepEqual(clock.sleeps, []);
});

test("sleeps the excess beyond lead when sending a burst", async () => {
  const clock = createFakeClock();
  const pacer = createAudioPacer({ sampleRate: 16000, leadMs: 1500, nowFn: clock.nowFn, sleepFn: clock.sleepFn });
  await pacer.pace(16000 * 3); // 3000ms of audio at t=0 → ahead 3000 → sleep 1500
  assert.deepEqual(clock.sleeps, [1500]);
  await pacer.pace(16000); // now t=1500, playback=4000ms → ahead 2500 → sleep 1000
  assert.deepEqual(clock.sleeps, [1500, 1000]);
});

test("elapsed real time reduces the backlog", async () => {
  const clock = createFakeClock();
  const pacer = createAudioPacer({ sampleRate: 16000, leadMs: 1500, nowFn: clock.nowFn, sleepFn: clock.sleepFn });
  await pacer.pace(16000 * 2); // ahead 2000 → sleep 500
  assert.deepEqual(clock.sleeps, [500]);
  clock.advance(5000); // playback caught up long ago
  await pacer.pace(16000); // ahead is negative → no sleep
  assert.deepEqual(clock.sleeps, [500]);
});

test("reset starts a fresh clock", async () => {
  const clock = createFakeClock();
  const pacer = createAudioPacer({ sampleRate: 16000, leadMs: 1500, nowFn: clock.nowFn, sleepFn: clock.sleepFn });
  await pacer.pace(16000 * 3);
  pacer.reset();
  await pacer.pace(16000); // fresh start: ahead 1000 < 1500 → no new sleep
  assert.deepEqual(clock.sleeps, [1500]);
});

test("requires sampleRate and sleepFn", () => {
  assert.throws(() => createAudioPacer({ sleepFn: async () => {} }));
  assert.throws(() => createAudioPacer({ sampleRate: 16000 }));
});
