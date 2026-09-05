import { describe, expect, it } from 'vitest';
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
    expect(await store.get('rsvp:guest:G1', 'k1')).toEqual({ payloadHash: 'hash1', response: { data: { ok: 2 }, sources: [] } });
    expect(await store.get('rsvp:guest:G2', 'k1')).toBeNull();
    now = new Date('2026-09-06T12:00:01Z');
    expect(await store.get('rsvp:guest:G1', 'k1')).toBeNull();
    expect(await purgeExpiredIdempotencyKeys(db, now)).toBe(1);
  });
});
