export const createAudioPacer = ({
  sampleRate,
  leadMs = 1500,
  nowFn = () => Date.now(),
  sleepFn,
} = {}) => {
  if (!sampleRate || sampleRate <= 0) {
    throw new Error("createAudioPacer requires sampleRate");
  }
  if (typeof sleepFn !== "function") {
    throw new Error("createAudioPacer requires sleepFn");
  }

  let totalSamples = 0;
  let startedAt = null;

  const pace = async (sampleCount) => {
    if (startedAt === null) {
      startedAt = nowFn();
    }
    totalSamples += sampleCount;
    const playbackMs = (totalSamples / sampleRate) * 1000;
    const elapsedMs = nowFn() - startedAt;
    const aheadMs = playbackMs - elapsedMs;
    if (aheadMs > leadMs) {
      await sleepFn(aheadMs - leadMs);
    }
  };

  const reset = () => {
    totalSamples = 0;
    startedAt = null;
  };

  return Object.freeze({ pace, reset });
};
