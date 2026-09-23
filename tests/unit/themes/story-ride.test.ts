import { describe, expect, it } from 'vitest';
import { DWELL, rideDuration, stepFactor, trainPosition } from '@/themes/botanical-deco/kit/StoryRide';
import { formatPartialDate } from '@/themes/shared/format';

describe('Our Story ride', () => {
  it('stops the train at every station before it moves on', () => {
    // The first 60% of each stop's scroll is spent standing at the platform: the stop is longer than the run.
    expect(DWELL).toBeGreaterThan(0.5);
    expect(trainPosition(0, 5)).toBe(0);
    expect(trainPosition(0.59, 5)).toBe(0);
    expect(trainPosition(1.2, 5)).toBe(1);
    // Then it accelerates away and brakes into the next one: slow, fast, slow.
    const early = trainPosition(1.7, 5) - 1;
    const middle = trainPosition(1.8, 5) - 1;
    const late = trainPosition(1.9, 5) - 1;
    expect(early).toBeGreaterThan(0);
    expect(middle).toBeCloseTo(0.5, 5);
    expect(late).toBeLessThan(1);
    expect(middle - early).toBeGreaterThan(early);
    expect(trainPosition(1.99999, 5)).toBeCloseTo(2, 3);
  });

  it('gives a button ride time to be seen, and caps a long one', () => {
    expect(rideDuration(1)).toBeGreaterThanOrEqual(800);
    expect(rideDuration(-3)).toBe(rideDuration(3));
    expect(rideDuration(7)).toBeGreaterThan(rideDuration(1));
    expect(rideDuration(40)).toBe(2400);
  });

  it('never runs off either end of the line', () => {
    expect(trainPosition(-3, 5)).toBe(0);
    expect(trainPosition(4.5, 5)).toBe(4);
    expect(trainPosition(99, 5)).toBe(4);
  });

  it('shortens the hop between stops on a long line so the ride stays walkable', () => {
    expect(stepFactor(8)).toBe(0.9);
    expect(stepFactor(16)).toBeCloseTo(0.6875);
    expect(stepFactor(60)).toBe(0.55);
  });

  it('shows a date exactly as precisely as it was recorded', () => {
    expect(formatPartialDate(undefined)).toBeUndefined();
    expect(formatPartialDate('2023')).toBe('2023');
    expect(formatPartialDate('2023-05')).toBe('May 2023');
    expect(formatPartialDate('2023-05-06')).toBe('May 6, 2023');
  });
});
