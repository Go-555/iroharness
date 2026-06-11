export const resamplePcm16 = (samples, fromRate, toRate) => {
  if (samples.length === 0) {
    return new Int16Array(0);
  }
  if (fromRate === toRate) {
    return Int16Array.from(samples);
  }
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(samples.length / ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, samples.length - 1);
    const frac = pos - left;
    out[i] = Math.round(samples[left] * (1 - frac) + samples[right] * frac);
  }
  return out;
};
