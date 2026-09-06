import { describe, expect, it } from 'vitest';
import { redactForAudit } from '@/contracts/audit';
import { readFlags, FEATURE_FLAGS } from '@/contracts/flags';
import { isId, newId, ID_PATTERN } from '@/contracts/ids';
import { canTransition, suggestedStateFor, LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { freshnessOf, FRESHNESS_POLICIES } from '@/contracts/provenance';

describe('ids', () => {
  it('generates 26-char Crockford ULIDs that sort by time', () => {
    const a = newId(1_000_000);
    const b = newId(2_000_000);
    expect(a).toMatch(ID_PATTERN);
    expect(isId(a)).toBe(true);
    expect(a < b).toBe(true);
    expect(isId('not-an-id')).toBe(false);
    expect(new Set(Array.from({ length: 200 }, () => newId())).size).toBe(200);
  });
});

describe('lifecycle', () => {
  it('allows forward moves and a single step back', () => {
    expect(canTransition('TEASER', 'RSVP_OPEN')).toBe(true);
    expect(canTransition('RSVP_OPEN', 'INVITATIONS_OPEN')).toBe(true);
    expect(canTransition('RSVP_OPEN', 'TEASER')).toBe(false);
    expect(canTransition('ARCHIVE', 'ARCHIVE')).toBe(false);
    expect(LIFECYCLE_STATES[0]).toBe('TEASER');
  });

  it('suggests a state from the calendar in the wedding time zone', () => {
    expect(suggestedStateFor(new Date('2026-09-05T12:00:00Z'))).toBe('RSVP_OPEN');
    expect(suggestedStateFor(new Date('2027-07-14T12:00:00Z'))).toBe('WEDDING_WEEK');
    expect(suggestedStateFor(new Date('2027-07-17T18:00:00Z'))).toBe('WEDDING_DAY');
    expect(suggestedStateFor(new Date('2027-07-25T12:00:00Z'))).toBe('POST_WEDDING');
    expect(suggestedStateFor(new Date('2027-09-25T12:00:00Z'))).toBe('ARCHIVE');
  });
});

describe('freshnessOf', () => {
  const now = new Date('2026-09-05T00:00:00Z');
  it('classifies by validity window then age', () => {
    expect(freshnessOf({ verifiedAt: '2026-09-01T00:00:00Z' }, FRESHNESS_POLICIES.operational, now)).toBe('fresh');
    expect(freshnessOf({ verifiedAt: '2026-07-01T00:00:00Z' }, FRESHNESS_POLICIES.operational, now)).toBe('aging');
    expect(freshnessOf({ verifiedAt: '2026-01-01T00:00:00Z' }, FRESHNESS_POLICIES.operational, now)).toBe('stale');
    expect(freshnessOf({ verifiedAt: '2026-09-01T00:00:00Z', validUntil: '2026-09-02T00:00:00Z' }, FRESHNESS_POLICIES.durable, now)).toBe('expired');
    expect(freshnessOf({ verifiedAt: '2026-09-01T00:00:00Z', validFrom: '2027-01-01T00:00:00Z' }, FRESHNESS_POLICIES.durable, now)).toBe('not_yet_valid');
  });
});

describe('readFlags', () => {
  it('uses production-safe defaults and honours FLAG_* overrides', () => {
    const defaults = readFlags({});
    expect(defaults.BIOMETRICS_ENABLED).toBe(false);
    expect(defaults.DESIGN_SWITCHER).toBe(true);
    const flags = readFlags({ FLAG_BIOMETRICS_ENABLED: 'on', NEXT_PUBLIC_FLAG_DESIGN_SWITCHER: 'off', FLAG_WEBMCP: 'nonsense' });
    expect(flags.BIOMETRICS_ENABLED).toBe(true);
    expect(flags.DESIGN_SWITCHER).toBe(false);
    expect(flags.WEBMCP).toBe(FEATURE_FLAGS.WEBMCP);
  });
});

describe('redactForAudit', () => {
  it('redacts sensitive keys and summarises nested values', () => {
    const out = redactForAudit({ otp: '123456', email: 'a@b.c', nested: { deep: 1 }, list: [1, 2], long: 'x'.repeat(300), fine: 'ok' });
    expect(out).toEqual({ otp: '[redacted]', email: '[redacted]', nested: '[object]', list: '[array:2]', long: 'x'.repeat(200) + '…', fine: 'ok' });
    expect(redactForAudit(undefined)).toBeUndefined();
  });
});
