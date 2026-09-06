import { describe, expect, it } from 'vitest';
import { computeFreshness, daysSinceVerified, FRESHNESS_LABELS, needsCaveat, policyFor } from '@/domain/content/freshness';

const day = (n: number, from = '2026-09-05T00:00:00Z') => new Date(Date.parse(from) + n * 86_400_000);
const verifiedAt = '2026-09-05T00:00:00Z';

describe('freshness policies (ADR-0011 rule 3)', () => {
  it('maps source types to budgets', () => {
    expect(policyFor('official-web')).toBe('operational');
    expect(policyFor('provider-api')).toBe('live');
    expect(policyFor('venue-document')).toBe('venue-document');
    expect(policyFor('authored')).toBe('durable');
    expect(policyFor('contract')).toBe('durable');
  });

  it('official pages age after 30 days and go stale after 90', () => {
    const row = { sourceType: 'official-web' as const, verifiedAt };
    expect(computeFreshness(row, day(10))).toBe('fresh');
    expect(computeFreshness(row, day(31))).toBe('aging');
    expect(computeFreshness(row, day(91))).toBe('stale');
  });

  it('venue documents age after 90 days and go stale after 180', () => {
    const row = { sourceType: 'venue-document' as const, verifiedAt };
    expect(computeFreshness(row, day(60))).toBe('fresh');
    expect(computeFreshness(row, day(100))).toBe('aging');
    expect(computeFreshness(row, day(200))).toBe('stale');
  });

  it('authored copy is durable (a year before aging)', () => {
    const row = { sourceType: 'authored' as const, verifiedAt };
    expect(computeFreshness(row, day(300))).toBe('fresh');
    expect(computeFreshness(row, day(400))).toBe('aging');
    expect(computeFreshness(row, day(800))).toBe('stale');
  });

  it('validity windows beat age: the closed Milk Room is expired, a future record is not yet valid', () => {
    expect(computeFreshness({ sourceType: 'venue-document', verifiedAt, validUntil: '2025-02-28T23:59:59Z' }, day(0))).toBe('expired');
    expect(computeFreshness({ sourceType: 'official-web', verifiedAt, validFrom: '2027-01-01T00:00:00Z' }, day(0))).toBe('not_yet_valid');
    expect(computeFreshness({ sourceType: 'official-web', verifiedAt: new Date(verifiedAt), validUntil: new Date('2026-12-31T00:00:00Z') }, day(1))).toBe('fresh');
  });

  it('caveats are required for anything but fresh', () => {
    expect(needsCaveat('fresh')).toBe(false);
    for (const f of ['aging', 'stale', 'expired', 'not_yet_valid'] as const) expect(needsCaveat(f)).toBe(true);
    expect(FRESHNESS_LABELS.expired.tone).toBe('bad');
    expect(daysSinceVerified(verifiedAt, day(45))).toBe(45);
  });
});
