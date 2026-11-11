/**
 * Microphone audio to what the speech model hears: one channel at 16 kHz. Devices record at 44.1
 * or 48 kHz, sometimes in stereo, so the channels are averaged and the result resampled by linear
 * interpolation, which is plenty for speech in the band the model listens to.
 */

/** Average the channels into one. A single channel is returned as is. */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0]!;
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) out[i]! += channel[i]!;
  }
  for (let i = 0; i < length; i++) out[i]! /= channels.length;
  return out;
}

/** Resample by linear interpolation. The output covers the same duration as the input. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError('sample rates must be positive');
  if (fromRate === toRate || input.length === 0) return input.slice();
  const length = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const step = fromRate / toRate;
  const last = input.length - 1;
  for (let i = 0; i < length; i++) {
    const x = i * step;
    const a = Math.min(Math.floor(x), last);
    const b = Math.min(a + 1, last);
    out[i] = input[a]! + (input[b]! - input[a]!) * (x - a);
  }
  return out;
}

/** Any recording to 16 kHz mono. */
export function toMono16k(channels: Float32Array[], sampleRate: number): Float32Array {
  return resampleLinear(downmix(channels), sampleRate, 16_000);
}
