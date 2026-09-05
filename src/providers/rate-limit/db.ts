import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { rateLimits } from '@/db/schema';
import { logger } from '@/lib/logger';
import { okConfig, upHealth } from '../base';
import { FAIL_CLOSED_RETRY_AFTER_MS, resolvePolicy, stepBucket, type RateLimitPolicy, type RateLimitPolicyName, type RateLimitProvider } from './types';

/**
 * Token bucket persisted in `rate_limits`. Read-modify-write inside a transaction with a row
 * lock, so concurrent instances agree. When the database errors, `consume` answers per the
 * policy's `failMode`: OTP policies fail closed (deny), everything else fails open with a logged
 * error. It never throws.
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
    try {
      return await this.step(key, p, cost, nowMs);
    } catch (e) {
      const closed = p.failMode === 'closed';
      // The key may identify a person (otp:<email>): log the policy shape, never the key.
      logger.error({ err: e, failMode: closed ? 'closed' : 'open', capacity: p.capacity }, 'rate limiter backend failed');
      return closed ? { allowed: false, remaining: 0, retryAfterMs: FAIL_CLOSED_RETRY_AFTER_MS } : { allowed: true, remaining: p.capacity };
    }
  }
  private step(key: string, p: RateLimitPolicy, cost: number, nowMs: number) {
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
