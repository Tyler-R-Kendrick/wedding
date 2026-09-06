import { and, desc, eq } from 'drizzle-orm';
import { redactForAudit, type AuditEvent, type AuditSink } from '@/contracts/audit';
import { newId, type AuditEventId } from '@/contracts/ids';
import { getDb, type Db } from '@/db/client';
import { auditEvents } from '@/db/schema';

/** Append-only audit sink backed by the `audit_events` table. Metadata is redacted before write. */
export class DbAuditSink implements AuditSink {
  constructor(private readonly db: Db) {}

  async record(event: Omit<AuditEvent, 'id' | 'at'>): Promise<AuditEventId> {
    const id = newId<AuditEventId>();
    await this.db.insert(auditEvents).values({
      id,
      at: new Date(),
      actor: event.actor,
      action: event.action,
      targetType: event.target.type,
      targetId: event.target.id,
      outcome: event.outcome,
      requestId: event.requestId,
      metadata: redactForAudit(event.metadata) ?? null,
    });
    return id;
  }
}

/** In-memory sink for unit tests. */
export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  async record(event: Omit<AuditEvent, 'id' | 'at'>): Promise<AuditEventId> {
    const id = newId<AuditEventId>();
    this.events.push({ ...event, id, at: new Date().toISOString(), metadata: redactForAudit(event.metadata) });
    return id;
  }
  find(action: AuditEvent['action']): AuditEvent[] {
    return this.events.filter((e) => e.action === action);
  }
}

let cached: Promise<AuditSink> | undefined;
/** The app's audit sink (DB-backed). */
export function getAuditSink(): Promise<AuditSink> {
  cached ??= getDb().then((db) => new DbAuditSink(db));
  return cached;
}

export async function listAuditEvents(
  db: Db,
  filter: { action?: AuditEvent['action']; targetType?: string; targetId?: string; requestId?: string; limit?: number } = {},
) {
  const conditions = [
    filter.action ? eq(auditEvents.action, filter.action) : undefined,
    filter.targetType ? eq(auditEvents.targetType, filter.targetType) : undefined,
    filter.targetId ? eq(auditEvents.targetId, filter.targetId) : undefined,
    filter.requestId ? eq(auditEvents.requestId, filter.requestId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  return db
    .select()
    .from(auditEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditEvents.at))
    .limit(Math.min(filter.limit ?? 100, 1000));
}
