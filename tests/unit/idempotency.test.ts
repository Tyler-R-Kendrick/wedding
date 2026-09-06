import { describe, expect, it } from 'vitest';
import { IDEMPOTENCY_RESERVATION_TTL_SECONDS, MemoryIdempotencyStore } from '@/capabilities/services';

describe('MemoryIdempotencyStore', () => {
  it('replays stored responses until the TTL passes', async () => {
    let now = 1_000_000;
    const store = new MemoryIdempotencyStore(() => now);
    expect(await store.get('scope', 'k')).toBeNull();
    await store.set('scope', 'k', 'hash', { data: 1 }, 60);
    expect(await store.get('scope', 'k')).toEqual({ payloadHash: 'hash', response: { data: 1 }, status: 'complete' });
    expect(await store.get('other', 'k')).toBeNull();
    now += 61_000;
    expect(await store.get('scope', 'k')).toBeNull();
  });

  it('reserves first: one winner, in-progress rows block, release and expiry free the key', async () => {
    let now = 1_000_000;
    const store = new MemoryIdempotencyStore(() => now);
    expect(await store.reserve('scope', 'r', 'h')).toEqual({ reserved: true });
    const again = await store.reserve('scope', 'r', 'h');
    expect(again).toEqual({ reserved: false, existing: { payloadHash: 'h', response: null, status: 'in_progress' } });
    await store.release('scope', 'r');
    expect(await store.get('scope', 'r')).toBeNull();
    expect((await store.reserve('scope', 'r', 'h')).reserved).toBe(true);
    await store.set('scope', 'r', 'h', { data: 2 });
    expect(await store.reserve('scope', 'r', 'h')).toEqual({ reserved: false, existing: { payloadHash: 'h', response: { data: 2 }, status: 'complete' } });
    expect((await store.reserve('scope', 'stale', 'h')).reserved).toBe(true);
    now += (IDEMPOTENCY_RESERVATION_TTL_SECONDS + 1) * 1000;
    expect((await store.reserve('scope', 'stale', 'h')).reserved).toBe(true);
  });
});
