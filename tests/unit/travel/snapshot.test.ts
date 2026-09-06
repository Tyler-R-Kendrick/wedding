import { describe, expect, it } from 'vitest';
import { formatDuration, formatMoney, isSnapshotUsable, REFRESH_BEFORE_BOOKING, snapshotExpiresAt, snapshotStatus, transferLabel } from '@/domain/travel/snapshot';

describe('live snapshots', () => {
  const snap = { retrievedAt: '2026-09-05T12:00:00.000Z', ttlSeconds: 600 };
  it('are fresh inside the TTL and stale after it, with an explicit expiry', () => {
    expect(snapshotExpiresAt(snap)).toBe('2026-09-05T12:10:00.000Z');
    expect(snapshotStatus(snap, new Date('2026-09-05T12:09:59Z'))).toBe('fresh');
    expect(snapshotStatus(snap, new Date('2026-09-05T12:10:01Z'))).toBe('stale');
    expect(isSnapshotUsable(snap, new Date('2026-09-05T12:00:00Z'))).toBe(true);
    expect(snapshotStatus({ retrievedAt: 'garbage', ttlSeconds: 600 })).toBe('stale');
    expect(REFRESH_BEFORE_BOOKING).toMatch(/refresh before you book/i);
  });

  it('label transfers so guests can tell protected connections from self-transfers', () => {
    expect(transferLabel('nonstop')).toEqual({ label: 'Nonstop' });
    expect(transferLabel('protected').caution).toMatch(/rebooks you/);
    expect(transferLabel('self_transfer').label).toMatch(/self-transfer/i);
    expect(transferLabel('self_transfer').caution).toMatch(/will not rebook/);
  });

  it('format durations and money without inventing precision', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(135)).toBe('2 h 15 min');
    expect(formatMoney(23450)).toBe('$235');
    expect(formatMoney(undefined)).toBeUndefined();
  });
});
