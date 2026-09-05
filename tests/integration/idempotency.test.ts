import { describe, expect, it } from 'vitest';
import { IDEMPOTENCY_RESERVATION_TTL_SECONDS } from '@/capabilities/services';
import { getDb } from '@/db/client';
import { DbIdempotencyStore, purgeExpiredIdempotencyKeys } from '@/lib/idempotency';

describe('DbIdempotencyStore', () => {
  it('stores and replays responses for 24h, then purges', async () => {
    const db = await getDb();
    let now = new Date('2026-09-05T12:00:00Z');
    const store = new DbIdempotencyStore(db, () => now);
    expect(await store.get('rsvp:guest:G1', 'k1')).toBeNull();
    await store.set('rsvp:guest:G1', 'k1', 'hash1', { data: { ok: 1 }, sources: [] });
    await store.set('rsvp:guest:G1', 'k1', 'hash1', { data: { ok: 2 }, sources: [] });
    expect(await store.get('rsvp:guest:G1', 'k1')).toEqual({ payloadHash: 'hash1', response: { data: { ok: 2 }, sources: [] }, status: 'complete' });
    expect(await store.get('rsvp:guest:G2', 'k1')).toBeNull();
    now = new Date('2026-09-06T12:00:01Z');
    expect(await store.get('rsvp:guest:G1', 'k1')).toBeNull();
    expect(await purgeExpiredIdempotencyKeys(db, now)).toBe(1);
  });

  it('reserves atomically: one winner per key, in-progress conflicts, release, and expired takeover', async () => {
    const db = await getDb();
    let now = new Date('2026-09-07T12:00:00Z');
    const store = new DbIdempotencyStore(db, () => now);
    const scope = 'submit_rsvp:guest:G9';
    const claims = await Promise.all([store.reserve(scope, 'r1', 'h'), store.reserve(scope, 'r1', 'h'), store.reserve(scope, 'r1', 'h')]);
    expect(claims.filter((c) => c.reserved)).toHaveLength(1);
    for (const c of claims.filter((c) => !c.reserved)) expect(!c.reserved && c.existing).toMatchObject({ status: 'in_progress', payloadHash: 'h', response: null });
    expect(await store.get(scope, 'r1')).toMatchObject({ status: 'in_progress' });

    await store.release(scope, 'r1');
    expect(await store.get(scope, 'r1')).toBeNull();
    expect((await store.reserve(scope, 'r1', 'h')).reserved).toBe(true);

    await store.set(scope, 'r1', 'h', { data: { ok: true }, sources: [] });
    expect(await store.reserve(scope, 'r1', 'h')).toEqual({ reserved: false, existing: { payloadHash: 'h', response: { data: { ok: true }, sources: [] }, status: 'complete' } });

    expect((await store.reserve(scope, 'stale', 'h')).reserved).toBe(true);
    expect((await store.reserve(scope, 'stale', 'h')).reserved).toBe(false);
    now = new Date(now.getTime() + (IDEMPOTENCY_RESERVATION_TTL_SECONDS + 1) * 1000);
    expect((await store.reserve(scope, 'stale', 'h2')).reserved).toBe(true);
    expect(await store.get(scope, 'stale')).toMatchObject({ status: 'in_progress', payloadHash: 'h2' });
  });
});
