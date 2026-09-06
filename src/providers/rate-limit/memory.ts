import { okConfig, upHealth } from '../base';
import { resolvePolicy, stepBucket, type RateLimitPolicy, type RateLimitPolicyName, type RateLimitProvider } from './types';

interface Bucket {
  tokens: number;
  updatedAt: number;
  /** When the bucket will be full again (a full bucket is indistinguishable from a fresh one). */
  fullAt?: number;
}

const g = globalThis as unknown as { __weddingRateLimits?: Map<string, Bucket> };

export const DEFAULT_MAX_KEYS = 50_000;

/**
 * Per-process buckets. Correct for a single instance; the DB limiter is required behind a load
 * balancer (and in production). When the table overflows, buckets that are already full are
 * dropped first (no behaviour change), then the least recently updated: a hot, drained bucket
 * is never the one reset.
 */
export class MemoryRateLimit implements RateLimitProvider {
  readonly kind = 'rate-limit' as const;
  readonly name = 'memory';
  readonly mode = 'mock' as const;
  readonly capabilities = { consume: true, distributed: false };
  private readonly buckets: Map<string, Bucket>;
  private readonly maxKeys: number;
  constructor(private readonly now: () => number = () => Date.now(), opts: { shared?: boolean; maxKeys?: number } = {}) {
    this.buckets = opts.shared === false ? new Map() : (g.__weddingRateLimits ??= new Map());
    this.maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
  }
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth(`${this.buckets.size} keys`);
  }
  async consume(key: string, policy: RateLimitPolicy | RateLimitPolicyName, cost = 1) {
    const p = resolvePolicy(policy);
    const nowMs = this.now();
    const b = this.buckets.get(key) ?? { tokens: p.capacity, updatedAt: nowMs };
    const { tokens, decision } = stepBucket(b.tokens, b.updatedAt, nowMs, p, cost);
    const fullAt = p.refillPerSecond > 0 ? nowMs + ((p.capacity - tokens) / p.refillPerSecond) * 1000 : Number.POSITIVE_INFINITY;
    this.buckets.set(key, { tokens, updatedAt: nowMs, fullAt });
    if (this.buckets.size > this.maxKeys) this.evict(nowMs);
    return decision;
  }
  async reset(key: string) {
    this.buckets.delete(key);
  }
  private evict(nowMs: number) {
    for (const [k, b] of this.buckets) if ((b.fullAt ?? Number.POSITIVE_INFINITY) <= nowMs) this.buckets.delete(k);
    if (this.buckets.size <= this.maxKeys) return;
    const byAge = [...this.buckets.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [k] of byAge) {
      if (this.buckets.size <= this.maxKeys) break;
      this.buckets.delete(k);
    }
  }
}
