import { and, eq, gt, lt } from 'drizzle-orm';
import type { IdempotencyRecord, IdempotencyStore } from '@/capabilities/services';
import type { Db } from '@/db/client';
import { idempotencyKeys } from '@/db/schema';

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** DB-backed idempotency store: (scope, key) -> stored response, 24h TTL. */
export class DbIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const rows = await this.db
      .select({ payloadHash: idempotencyKeys.payloadHash, response: idempotencyKeys.response })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key), gt(idempotencyKeys.expiresAt, this.now())))
      .limit(1);
    const row = rows[0];
    return row ? { payloadHash: row.payloadHash, response: row.response } : null;
  }

  async set(scope: string, key: string, payloadHash: string, response: unknown, ttlSeconds = IDEMPOTENCY_TTL_SECONDS): Promise<void> {
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    await this.db
      .insert(idempotencyKeys)
      .values({ scope, key, payloadHash, response: response as Record<string, unknown>, createdAt: now, expiresAt })
      .onConflictDoUpdate({ target: [idempotencyKeys.scope, idempotencyKeys.key], set: { payloadHash, response: response as Record<string, unknown>, createdAt: now, expiresAt } });
  }
}

/** Housekeeping job: delete expired rows. */
export async function purgeExpiredIdempotencyKeys(db: Db, now: Date = new Date()): Promise<number> {
  const deleted = await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, now)).returning({ key: idempotencyKeys.key });
  return deleted.length;
}
