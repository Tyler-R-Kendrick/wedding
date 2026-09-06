import type { Db } from '@/db/client';
import type { ServerEnv } from '@/lib/env';
import { DbRateLimit } from './db';
import { MemoryRateLimit } from './memory';
import type { RateLimitProvider } from './types';

export * from './types';
export { MemoryRateLimit } from './memory';
export { DbRateLimit } from './db';

/**
 * RATE_LIMIT_BACKEND=db|memory; default db in production (multi-instance safe), memory elsewhere.
 * Production never gets the memory limiter: per-process buckets behind a load balancer are not a
 * limit, so a missing database or RATE_LIMIT_BACKEND=memory is a configuration error there.
 */
export function createRateLimitProvider(env: Pick<ServerEnv, 'RATE_LIMIT_BACKEND' | 'isProduction' | 'FORCE_MOCK_PROVIDERS'>, deps: { db?: Db } = {}): RateLimitProvider {
  const backend = env.RATE_LIMIT_BACKEND ?? (env.isProduction ? 'db' : 'memory');
  if (env.isProduction) {
    if (backend === 'memory' || env.FORCE_MOCK_PROVIDERS) throw new Error('rate-limit: the memory backend is not allowed in production (set RATE_LIMIT_BACKEND=db)');
    if (!deps.db) throw new Error('rate-limit: production requires a database; call getProvider("rate-limit", { db })');
    return new DbRateLimit(deps.db);
  }
  if (backend === 'db' && !env.FORCE_MOCK_PROVIDERS && deps.db) return new DbRateLimit(deps.db);
  return new MemoryRateLimit();
}
