import { describe, expect, it } from 'vitest';
import { clearTravelSearchCache, getCachedTravelSnapshot, setCachedTravelSnapshot, travelSearchCacheKey } from '@/domain/travel/snapshot-cache';

describe('travel search snapshot cache', () => {
  it('stores and returns snapshots until TTL expires', () => {
    clearTravelSearchCache();
    const key = travelSearchCacheKey('travelpayouts', 'flights', { origin: 'LAX' });
    expect(getCachedTravelSnapshot(key, 0)).toBeUndefined();
    setCachedTravelSnapshot(key, { provider: 'travelpayouts', retrievedAt: '2026-01-01T00:00:00.000Z', ttlSeconds: 60, data: [] }, 0);
    expect(getCachedTravelSnapshot(key, 30_000)?.provider).toBe('travelpayouts');
    expect(getCachedTravelSnapshot(key, 61_000)).toBeUndefined();
  });
});
