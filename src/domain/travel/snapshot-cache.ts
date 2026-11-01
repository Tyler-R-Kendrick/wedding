import { createHash } from 'node:crypto';
import type { LiveSnapshot } from '@/contracts/providers';

/**
 * Process-local cache for partner search snapshots. Keeps identical guest searches off the wire
 * until the snapshot TTL expires so free-tier quotas (Travelpayouts, SerpApi, …) are not spent
 * on every click. Not shared across serverless instances — that is intentional: each instance
 * still respects TTL and the partner's own rate limits.
 */
const store = new Map<string, { expiresAtMs: number; snapshot: LiveSnapshot<unknown> }>();

export function travelSearchCacheKey(provider: string, kind: 'flights' | 'hotels', params: Record<string, unknown>): string {
  const payload = JSON.stringify({ provider, kind, params });
  return createHash('sha256').update(payload).digest('hex');
}

export function getCachedTravelSnapshot<T>(key: string, nowMs: number = Date.now()): LiveSnapshot<T> | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (nowMs >= hit.expiresAtMs) {
    store.delete(key);
    return undefined;
  }
  return hit.snapshot as LiveSnapshot<T>;
}

export function setCachedTravelSnapshot<T>(key: string, snapshot: LiveSnapshot<T>, nowMs: number = Date.now()): void {
  const expiresAtMs = nowMs + snapshot.ttlSeconds * 1000;
  store.set(key, { expiresAtMs, snapshot: snapshot as LiveSnapshot<unknown> });
  if (store.size > 500) {
    for (const [k, v] of store) {
      if (nowMs >= v.expiresAtMs) store.delete(k);
      if (store.size <= 400) break;
    }
  }
}

/** Test helper: drop every entry. */
export function clearTravelSearchCache(): void {
  store.clear();
}
