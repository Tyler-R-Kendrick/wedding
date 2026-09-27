import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackoffPoll } from '@/components/media/poll';

function fakeDoc(initial: DocumentVisibilityState = 'visible') {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  const set = (v: DocumentVisibilityState) => {
    doc.visibilityState = v;
    for (const fn of listeners) fn();
  };
  return { doc: doc as unknown as Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>, set, listeners };
}

describe('upload status polling backs off', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks at once, then with a growing gap up to the cap', async () => {
    const { doc } = fakeDoc();
    const at: number[] = [];
    const stop = startBackoffPoll(async () => void at.push(Date.now()), { first: 1000, growth: 2, max: 4000, doc });
    await vi.advanceTimersByTimeAsync(20_000);
    stop();
    const gaps = at.slice(1).map((t, i) => t - at[i]!);
    expect(gaps.slice(0, 5)).toEqual([1000, 2000, 4000, 4000, 4000]);
  });

  it('does not poll while hidden, restarts at the first gap when shown, and never runs two chains', async () => {
    const { doc, set } = fakeDoc();
    let calls = 0;
    let release: () => void = () => {};
    const stop = startBackoffPoll(
      () =>
        new Promise<void>((r) => {
          calls++;
          release = r;
        }),
      { first: 1000, growth: 2, max: 8000, doc },
    );
    expect(calls).toBe(1);
    // Hidden and shown again while the first request is still in flight: one new chain starts...
    set('hidden');
    set('visible');
    expect(calls).toBe(2);
    // ...and the stale request, returning now, schedules nothing.
    release();
    await vi.advanceTimersByTimeAsync(0);
    set('hidden');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);
    set('visible');
    expect(calls).toBe(3);
    stop();
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(3);
  });

  it('keeps polling after a tick that throws, and tells a late tick it is no longer live', async () => {
    const { doc } = fakeDoc();
    let calls = 0;
    const seen: boolean[] = [];
    let finish: () => void = () => {};
    const stop = startBackoffPoll(
      (live) => {
        calls++;
        if (calls === 1) return Promise.reject(new Error('network'));
        return new Promise<void>((r) => {
          finish = () => {
            seen.push(live());
            r();
          };
        });
      },
      { first: 1000, growth: 1, max: 1000, doc },
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    stop();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([false]);
  });
});
