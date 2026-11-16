import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import posthog, { connectPostHog, resetPostHogFacade, type PostHogSink } from '@/lib/observe/posthog';

/**
 * The facade components call instead of importing the SDK (src/lib/observe/posthog.ts): calls made
 * before the SDK has loaded are kept in order and replayed; with PostHog off they are dropped.
 */
const TOKEN = 'phc_0123456789abcdefghijklmnopqrstuvwxyzABCD';

function sink() {
  const calls: unknown[][] = [];
  const record = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);
  const made: PostHogSink = { capture: record('capture'), captureException: record('captureException'), identify: record('identify'), reset: record('reset') };
  return { made, calls };
}

beforeEach(() => resetPostHogFacade());
afterEach(() => vi.unstubAllEnvs());

describe('the PostHog facade', () => {
  it('drops every call when PostHog is not configured, and never throws', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', '');
    posthog.capture('rsvp_submitted', { event_count: 2 });
    posthog.identify('ACCOUNT_1');
    const { made, calls } = sink();
    connectPostHog(made);
    expect(calls).toEqual([]);
  });

  it('keeps what was called before the SDK arrived, in order, and replays it once', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', TOKEN);
    const boom = new Error('boom');
    posthog.reset();
    posthog.identify('ACCOUNT_1');
    posthog.capture('rsvp_submitted', { event_count: 2 });
    posthog.captureException(boom, { digest: '123' });
    const { made, calls } = sink();
    connectPostHog(made);
    expect(calls).toEqual([['reset'], ['identify', 'ACCOUNT_1', undefined], ['capture', 'rsvp_submitted', { event_count: 2 }], ['captureException', boom, { digest: '123' }]]);
    connectPostHog(made);
    expect(calls).toHaveLength(4);
  });

  it('passes calls straight through once connected', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', TOKEN);
    const { made, calls } = sink();
    connectPostHog(made);
    posthog.capture('trip_calendar_exported');
    expect(calls).toEqual([['capture', 'trip_calendar_exported', undefined]]);
  });

  it('keeps only the most recent calls when a page fires many before the SDK loads', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', TOKEN);
    for (let i = 0; i < 150; i++) posthog.capture(`event_${i}`);
    const { made, calls } = sink();
    connectPostHog(made);
    expect(calls).toHaveLength(100);
    expect(calls[0]).toEqual(['capture', 'event_50', undefined]);
  });

  it('survives an SDK method that throws', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', TOKEN);
    const { made } = sink();
    connectPostHog({ ...made, capture: () => { throw new Error('sdk failed'); } });
    expect(() => posthog.capture('x')).not.toThrow();
  });
});
