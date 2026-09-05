import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { rateLimits } from '@/db/schema';
import { okConfig, upHealth } from '../base';
import { resolvePolicy, stepBucket, type RateLimitPolicy, type RateLimitPolicyName, type RateLimitProvider } from './types';

/**
 * Token bucket persisted in `rate_limits`. Read-modify-write inside a transaction with a row
 * lock, so concurrent instances agree. Fails open on database errors (availability over strictness
 * for guest-facing reads); callers protecting OTP flows should treat `allowed:false` as final.
 */
export class DbRateLimit implements RateLimitProvider {
  readonly kind = 'rate-limit' as const;
  readonly name = 'db';
  readonly mode = 'live' as const;
  readonly capabilities = { consume: true, distributed: true };
  constructor(private readonly db: Db, private readonly now: () => number = () => Date.now()) {}
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  async consume(key: string, policy: RateLimitPolicy | RateLimitPolicyName, cost = 1) {
    const p = resolvePolicy(policy);
    const nowMs = this.now();
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(rateLimits).where(eq(rateLimits.key, key)).for('update').limit(1);
      const row = rows[0];
      const { tokens, decision } = stepBucket(row?.tokens ?? p.capacity, row?.updatedAt.getTime() ?? nowMs, nowMs, p, cost);
      if (row) {
        await tx.update(rateLimits).set({ tokens, updatedAt: new Date(nowMs) }).where(eq(rateLimits.key, key));
      } else {
        await tx.insert(rateLimits).values({ key, tokens, updatedAt: new Date(nowMs) }).onConflictDoUpdate({ target: rateLimits.key, set: { tokens, updatedAt: new Date(nowMs) } });
      }
      return decision;
    });
  }
  async reset(key: string) {
    await this.db.delete(rateLimits).where(eq(rateLimits.key, key));
  }
}
