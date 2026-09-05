import { and, desc, eq } from 'drizzle-orm';
import type { AuditAction, AuditSink } from '@/contracts/audit';
import type { CapabilityExposure } from '@/contracts/capability';
import { newId, type ExternalActionId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { externalActionRecords, type ExternalActionKind, type ExternalActionRecordRow, type ExternalActionStatus } from '@/db/schema';
import { hostOf } from './handoff';

export interface RecordExternalActionInput {
  kind: ExternalActionKind;
  provider: string;
  status: ExternalActionStatus;
  actor: PrincipalRef;
  target: { type: string; id: string };
  /** Full URL is reduced to its host before storage (deep links carry dates/party sizes). */
  url?: string;
  surface: keyof CapabilityExposure;
  requestId: string;
  /** Redacted by the audit sink; keep to ids, kinds, counts. Never a code, link, or contact detail. */
  metadata?: Record<string, unknown>;
}

const AUDIT_FOR_STATUS: Record<ExternalActionStatus, AuditAction> = {
  initiated: 'external_action.initiated',
  prepared: 'external_action.initiated',
  committed: 'external_action.confirmed',
  failed: 'external_action.failed',
};

/**
 * Every external handoff or commit (ADR-0004) writes one `external_action_records` row and
 * one audit event. An `initiated` record means "a link was handed over" — it never means
 * anything was bought, booked, or redeemed.
 */
export async function recordExternalAction(db: Db, audit: AuditSink, input: RecordExternalActionInput): Promise<ExternalActionId> {
  const id = newId<ExternalActionId>();
  const urlHost = input.url ? (hostOf(input.url) ?? null) : null;
  const metadata = { ...(input.metadata ?? {}), ...(urlHost ? { host: urlHost } : {}) };
  await db.insert(externalActionRecords).values({
    id,
    kind: input.kind,
    provider: input.provider,
    status: input.status,
    actor: input.actor,
    targetType: input.target.type,
    targetId: input.target.id,
    urlHost,
    surface: input.surface,
    requestId: input.requestId,
    metadata,
  });
  await audit.record({
    actor: input.actor,
    action: AUDIT_FOR_STATUS[input.status],
    target: input.target,
    outcome: input.status === 'failed' ? 'failed' : 'success',
    requestId: input.requestId,
    metadata: { externalActionId: id, kind: input.kind, provider: input.provider, status: input.status, surface: input.surface, ...metadata },
  });
  return id;
}

export async function listExternalActions(
  db: Db,
  filter: { kind?: ExternalActionKind; targetType?: string; targetId?: string; limit?: number } = {},
): Promise<ExternalActionRecordRow[]> {
  const conditions = [
    filter.kind ? eq(externalActionRecords.kind, filter.kind) : undefined,
    filter.targetType ? eq(externalActionRecords.targetType, filter.targetType) : undefined,
    filter.targetId ? eq(externalActionRecords.targetId, filter.targetId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  return db
    .select()
    .from(externalActionRecords)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(externalActionRecords.createdAt))
    .limit(Math.min(filter.limit ?? 100, 500));
}
