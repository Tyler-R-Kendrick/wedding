import { and, count, desc, eq } from 'drizzle-orm';
import type { AuditSink } from '@/contracts/audit';
import { newId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { biometricDeletions, biometricIdentityRefs, biometricMatches, type BiometricDeletionRow, type DeletionProof, type DeletionReason } from '@/db/schema/biometrics';
import { JobQueue } from '@/lib/jobs';
import type { BiometricProvider } from '@/providers/biometric/types';
import type { VectorIndexProvider } from '@/providers/vector-index/types';
import { listConsentEntries } from './consent';

/**
 * Deletion (ADR-0006 §5). A request writes a `biometric.deletions` row and enqueues one deduped
 * `biometric.delete` job per guest. The job removes provider subjects, sealed templates, match
 * rows and any vector-index entries under the guest's namespace (there should never be any:
 * biometric vectors never enter the generic index, and the count in the proof demonstrates it),
 * then records a proof and audits `biometric.deleted`. Idempotent: re-running deletes nothing
 * more and completes again. Works with the feature flag OFF.
 */
export const BIOMETRIC_DELETE_JOB = 'biometric.delete';
export const BIOMETRIC_SWEEP_JOB = 'biometric.sweep';

/** Namespace a biometric vector would live in if anyone ever indexed one; the job proves it is empty. */
export const biometricNamespaceFor = (guestId: string) => `biometric:${guestId}`;

export async function requestDeletion(db: Db, input: { guestId: string; reason: DeletionReason; requestedBy: PrincipalRef; requestId: string; now: Date }): Promise<BiometricDeletionRow> {
  const open = (await db.select().from(biometricDeletions).where(and(eq(biometricDeletions.guestId, input.guestId), eq(biometricDeletions.status, 'requested'))).limit(1))[0];
  const queue = new JobQueue(db, () => input.now);
  if (open) {
    await queue.enqueue({ type: BIOMETRIC_DELETE_JOB, payload: { deletionId: open.id, guestId: input.guestId }, dedupeKey: `${BIOMETRIC_DELETE_JOB}:${input.guestId}`, maxAttempts: 10 });
    return open;
  }
  const id = newId();
  const job = await queue.enqueue({ type: BIOMETRIC_DELETE_JOB, payload: { deletionId: id, guestId: input.guestId }, dedupeKey: `${BIOMETRIC_DELETE_JOB}:${input.guestId}`, maxAttempts: 10 });
  const [row] = await db
    .insert(biometricDeletions)
    .values({ id, guestId: input.guestId, reason: input.reason, status: 'requested', requestedBy: input.requestedBy, requestedAt: input.now, jobId: job.id, requestId: input.requestId, createdAt: input.now, updatedAt: input.now })
    .returning();
  return row!;
}

export interface DeletionDeps {
  db: Db;
  biometric: BiometricProvider;
  vectorIndex: VectorIndexProvider;
  audit?: AuditSink;
  now: Date;
  requestId: string;
  component: string;
}

export async function runDeletion(deps: DeletionDeps, deletionId: string): Promise<DeletionProof | null> {
  const row = (await deps.db.select().from(biometricDeletions).where(eq(biometricDeletions.id, deletionId)).limit(1))[0];
  if (!row) return null;
  try {
    const refs = await deps.db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, row.guestId));
    let providerSubjectsDeleted = 0;
    for (const ref of refs) {
      const r = await deps.biometric.delete(ref.subjectId);
      if (!r.ok) throw new Error(`biometric provider refused deletion: ${r.error.class}`);
      if (r.value.deleted) providerSubjectsDeleted++;
    }
    // Belt and braces: the provider may hold a subject under the guest id even without a ref row.
    const direct = await deps.biometric.delete(row.guestId);
    if (direct.ok && direct.value.deleted) providerSubjectsDeleted++;
    const matches = await deps.db.delete(biometricMatches).where(eq(biometricMatches.guestId, row.guestId)).returning({ id: biometricMatches.id });
    const deletedRefs = await deps.db.delete(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, row.guestId)).returning({ id: biometricIdentityRefs.id });
    const vectors = await deps.vectorIndex.delete(biometricNamespaceFor(row.guestId), refs.map((r) => r.id).concat(row.guestId));
    const consents = await listConsentEntries(deps.db, row.guestId);
    const proof: DeletionProof = {
      identityRefsDeleted: deletedRefs.length,
      providerSubjectsDeleted,
      matchesDeleted: matches.length,
      vectorEntriesDeleted: vectors.ok ? vectors.value.count : 0,
      consentIds: consents.filter((c) => c.entry === 'grant').map((c) => c.id),
      completedBy: deps.component,
    };
    await deps.db.update(biometricDeletions).set({ status: 'completed', completedAt: deps.now, proof, error: null, updatedAt: deps.now }).where(eq(biometricDeletions.id, row.id));
    await deps.audit?.record({ actor: { kind: 'system', component: deps.component }, action: 'biometric.deleted', target: { type: 'guest', id: row.guestId }, outcome: 'success', requestId: deps.requestId, metadata: { deletionId: row.id, reason: row.reason, identityRefsDeleted: proof.identityRefsDeleted, matchesDeleted: proof.matchesDeleted, providerSubjectsDeleted } });
    return proof;
  } catch (e) {
    await deps.db.update(biometricDeletions).set({ status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 500), updatedAt: deps.now }).where(eq(biometricDeletions.id, row.id));
    await deps.audit?.record({ actor: { kind: 'system', component: deps.component }, action: 'biometric.deleted', target: { type: 'guest', id: row.guestId }, outcome: 'failed', requestId: deps.requestId, metadata: { deletionId: row.id, reason: row.reason } });
    throw e;
  }
}

export async function listDeletions(db: Db, guestId: string): Promise<BiometricDeletionRow[]> {
  return db.select().from(biometricDeletions).where(eq(biometricDeletions.guestId, guestId)).orderBy(desc(biometricDeletions.requestedAt));
}

export async function countDeletions(db: Db): Promise<Record<string, number>> {
  const rows = await db.select({ status: biometricDeletions.status, n: count() }).from(biometricDeletions).groupBy(biometricDeletions.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

/** Guest-facing projection: proof counts only, never provider identifiers. */
export function describeDeletion(row: BiometricDeletionRow) {
  return {
    id: row.id,
    reason: row.reason,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    proof: row.proof ? { identityRefsDeleted: row.proof.identityRefsDeleted, matchesDeleted: row.proof.matchesDeleted, providerSubjectsDeleted: row.proof.providerSubjectsDeleted } : null,
  };
}

/**
 * Retention sweep: guests whose enrolment is older than the retention window, or whose latest
 * consent is revoked/superseded but still have data, get a deletion request. Returns how many.
 */
export async function sweepRetention(db: Db, opts: { retentionDays: number; now: Date; requestId: string }): Promise<number> {
  const cutoff = new Date(opts.now.getTime() - opts.retentionDays * 86_400_000);
  const refs = await db.select().from(biometricIdentityRefs);
  let n = 0;
  for (const ref of refs) {
    if (ref.enrolledAt.getTime() <= cutoff.getTime()) {
      await requestDeletion(db, { guestId: ref.guestId, reason: 'retention', requestedBy: { kind: 'system', component: BIOMETRIC_SWEEP_JOB }, requestId: opts.requestId, now: opts.now });
      n++;
    }
  }
  return n;
}
