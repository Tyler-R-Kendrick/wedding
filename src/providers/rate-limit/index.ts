import type { Db } from '@/db/client';
import type { ServerEnv } from '@/lib/env';
import { DbRateLimit } from './db';
import { MemoryRateLimit } from './memory';
import type { RateLimitProvider } from './types';

export * from './types';
export { MemoryRateLimit } from './memory';
export { DbRateLimit } from './db';

/** RATE_LIMIT_BACKEND=db|memory; default db in production (multi-instance safe), memory elsewhere. */
export function createRateLimitProvider(env: Pick<ServerEnv, 'RATE_LIMIT_BACKEND' | 'isProduction' | 'FORCE_MOCK_PROVIDERS'>, deps: { db?: Db } = {}): RateLimitProvider {
  const backend = env.RATE_LIMIT_BACKEND ?? (env.isProduction ? 'db' : 'memory');
  if (backend === 'db' && !env.FORCE_MOCK_PROVIDERS && deps.db) return new DbRateLimit(deps.db);
  return new MemoryRateLimit();
}
