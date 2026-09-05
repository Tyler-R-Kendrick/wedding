import { describe, expect, it } from 'vitest';
import { MemoryIdempotencyStore } from '@/capabilities/services';

describe('MemoryIdempotencyStore', () => {
  it('replays stored responses until the TTL passes', async () => {
    let now = 1_000_000;
    const store = new MemoryIdempotencyStore(() => now);
    expect(await store.get('scope', 'k')).toBeNull();
    await store.set('scope', 'k', 'hash', { data: 1 }, 60);
    expect(await store.get('scope', 'k')).toEqual({ payloadHash: 'hash', response: { data: 1 } });
    expect(await store.get('other', 'k')).toBeNull();
    now += 61_000;
    expect(await store.get('scope', 'k')).toBeNull();
  });
});
