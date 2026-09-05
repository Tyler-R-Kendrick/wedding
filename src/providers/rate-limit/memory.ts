import { okConfig, upHealth } from '../base';
import { resolvePolicy, stepBucket, type RateLimitPolicy, type RateLimitPolicyName, type RateLimitProvider } from './types';

const g = globalThis as unknown as { __weddingRateLimits?: Map<string, { tokens: number; updatedAt: number }> };

/** Per-process buckets. Correct for a single instance; use the DB limiter behind a load balancer. */
export class MemoryRateLimit implements RateLimitProvider {
  readonly kind = 'rate-limit' as const;
  readonly name = 'memory';
  readonly mode = 'mock' as const;
  readonly capabilities = { consume: true, distributed: false };
  private readonly buckets: Map<string, { tokens: number; updatedAt: number }>;
  constructor(private readonly now: () => number = () => Date.now(), opts: { shared?: boolean } = {}) {
    this.buckets = opts.shared === false ? new Map() : (g.__weddingRateLimits ??= new Map());
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
    this.buckets.set(key, { tokens, updatedAt: nowMs });
    if (this.buckets.size > 50_000) this.buckets.delete(this.buckets.keys().next().value as string);
    return decision;
  }
  async reset(key: string) {
    this.buckets.delete(key);
  }
}
