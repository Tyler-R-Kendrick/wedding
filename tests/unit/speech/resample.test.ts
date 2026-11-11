import { describe, expect, it } from 'vitest';
import { downmix, resampleLinear, toMono16k } from '@/lib/speech/resample';

/** A sine at `hz`, `seconds` long, sampled at `rate`. */
const sine = (hz: number, rate: number, seconds: number) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));

describe('microphone audio to 16 kHz mono', () => {
  it('averages the channels', () => {
    expect([...downmix([Float32Array.from([1, 0.5]), Float32Array.from([0, -0.5])])]).toEqual([0.5, 0]);
    const one = Float32Array.from([0.25]);
    expect(downmix([one])).toBe(one);
    expect(downmix([])).toHaveLength(0);
  });

  it('keeps the duration, whatever the device rate', () => {
    for (const rate of [8000, 16000, 22050, 44100, 48000, 96000]) {
      const out = resampleLinear(new Float32Array(rate * 2), rate, 16000);
      expect(out.length, `${rate} Hz`).toBe(32000);
    }
    // 11 s at 44.1 kHz, the length of the test clip used in the real check.
    expect(resampleLinear(new Float32Array(485_100), 44100, 16000)).toHaveLength(176_000);
  });

  it('interpolates between neighbouring samples', () => {
    // Doubling the rate puts a midpoint between every pair.
    expect([...resampleLinear(Float32Array.from([0, 1, 0]), 8000, 16000)]).toEqual([0, 0.5, 1, 0.5, 0, 0]);
    // Halving it keeps every other sample.
    expect([...resampleLinear(Float32Array.from([0, 1, 2, 3]), 32000, 16000)]).toEqual([0, 2]);
  });

  it('preserves a speech-band tone through 48 kHz to 16 kHz', () => {
    const out = toMono16k([sine(440, 48000, 0.1)], 48000);
    const expected = sine(440, 16000, 0.1);
    expect(out).toHaveLength(expected.length);
    const worst = Math.max(...out.map((v, i) => Math.abs(v - expected[i]!)));
    expect(worst).toBeLessThan(0.01);
  });

  it('returns a copy when no resampling is needed, and refuses nonsense rates', () => {
    const input = Float32Array.from([1, 2]);
    const out = resampleLinear(input, 16000, 16000);
    expect(out).not.toBe(input);
    expect([...out]).toEqual([1, 2]);
    expect(() => resampleLinear(input, 0, 16000)).toThrow(RangeError);
  });
});
