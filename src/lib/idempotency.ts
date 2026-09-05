import { and, eq, gt, lt, lte } from 'drizzle-orm';
import { IDEMPOTENCY_RESERVATION_TTL_SECONDS, type IdempotencyRecord, type IdempotencyReservation, type IdempotencyStore } from '@/capabilities/services';
import type { Db } from '@/db/client';
import { idempotencyKeys } from '@/db/schema';

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * DB-backed idempotency store: (scope, key) -> stored response, 24h TTL.
 * `reserve` is an INSERT ... ON CONFLICT DO NOTHING, so exactly one of any number of
 * concurrent callers wins; the rest see the live row and replay or conflict.
 */
export class DbIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const rows = await this.db
      .select({ payloadHash: idempotencyKeys.payloadHash, response: idempotencyKeys.response, status: idempotencyKeys.status })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key), gt(idempotencyKeys.expiresAt, this.now())))
      .limit(1);
    const row = rows[0];
    return row ? { payloadHash: row.payloadHash, response: row.response, status: row.status } : null;
  }

  async set(scope: string, key: string, payloadHash: string, response: unknown, ttlSeconds = IDEMPOTENCY_TTL_SECONDS): Promise<void> {
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const values = { payloadHash, status: 'complete' as const, response: response as Record<string, unknown>, createdAt: now, expiresAt };
    await this.db
      .insert(idempotencyKeys)
      .values({ scope, key, ...values })
      .onConflictDoUpdate({ target: [idempotencyKeys.scope, idempotencyKeys.key], set: values });
  }

  async reserve(scope: string, key: string, payloadHash: string, ttlSeconds = IDEMPOTENCY_RESERVATION_TTL_SECONDS): Promise<IdempotencyReservation> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = this.now();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
      const values = { payloadHash, status: 'in_progress' as const, response: null, createdAt: now, expiresAt };
      const inserted = await this.db.insert(idempotencyKeys).values({ scope, key, ...values }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
      if (inserted.length > 0) return { reserved: true };
      // An expired row (stale reservation or old outcome) may be taken over, atomically.
      const taken = await this.db
        .update(idempotencyKeys)
        .set(values)
        .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key), lte(idempotencyKeys.expiresAt, now)))
        .returning({ key: idempotencyKeys.key });
      if (taken.length > 0) return { reserved: true };
      const existing = await this.get(scope, key);
      if (existing) return { reserved: false, existing };
      // The row vanished between statements (released concurrently): try again.
    }
    throw new Error('idempotency reservation could not be established');
  }

  async release(scope: string, key: string): Promise<void> {
    await this.db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  }
}

/** Housekeeping job: delete expired rows. */
export async function purgeExpiredIdempotencyKeys(db: Db, now: Date = new Date()): Promise<number> {
  const deleted = await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, now)).returning({ key: idempotencyKeys.key });
  return deleted.length;
}
