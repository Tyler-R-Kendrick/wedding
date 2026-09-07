import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { AuditSink } from '@/contracts/audit';
import { newId } from '@/contracts/ids';
import type { GuestId, HouseholdId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { biometricDeletions, biometricIdentityRefs, biometricMatches, type BiometricDeletionRow, type DeletionProof, type DeletionReason } from '@/db/schema/biometrics';
import { idempotencyKeys } from '@/db/schema/idempotency';
import { JobQueue } from '@/lib/jobs';
import { principalKey } from '@/policy/confirmation';
import type { BiometricProvider } from '@/providers/biometric/types';
import type { VectorIndexProvider } from '@/providers/vector-index/types';
import { getConsentState, hasCurrentConsent, listConsentEntries } from './consent';

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

/**
 * Capabilities whose stored response would be, or would reveal, biometric data. The invoke
 * pipeline keys stored responses by `<capability>:<principalKey>`, so deleting these scopes for one
 * guest removes every cached copy of their results from the public `idempotency_keys` table.
 *
 * `find_photos_of_me` and `enroll_biometric_reference` are `replayable: false` and so store nothing
 * today; this sweep is the belt to that braces. It also catches rows written before that flag
 * existed, and any capability added later that forgets it.
 */
export const BIOMETRIC_RESPONSE_SCOPES = [
  'find_photos_of_me',
  'enroll_biometric_reference',
  'revoke_biometric_consent',
  'request_biometric_deletion',
  'grant_biometric_consent',
] as const;

/**
 * The idempotency scope suffix the pipeline uses for this guest. `principalKey` keys a guest on
 * their guest id alone; the household is required by the type and ignored by the function, and
 * `tests/unit/biometrics/deletion.test.ts` pins that agreement so this cannot silently drift.
 */
export function guestScopeKey(guestId: string): string {
  return principalKey({ kind: 'guest', guestId: guestId as GuestId, householdId: '' as HouseholdId });
}

/**
 * Removes every cached capability response for this guest's biometric capabilities.
 *
 * Deliberately NOT the `confirm:` nonce scopes for the same capabilities: those rows hold no
 * response body (they are reserve-only), and they are what makes a confirmation token single-use.
 * Deleting them would let an unexpired grant token be redeemed a second time.
 */
export async function purgeCachedBiometricResponses(db: Db, guestId: string): Promise<number> {
  const key = guestScopeKey(guestId);
  const scopes = BIOMETRIC_RESPONSE_SCOPES.map((name) => `${name}:${key}`);
  const deleted = await db.delete(idempotencyKeys).where(inArray(idempotencyKeys.scope, scopes)).returning({ key: idempotencyKeys.key });
  return deleted.length;
}

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
    const namespace = biometricNamespaceFor(row.guestId);
    const vectors = await deps.vectorIndex.delete(namespace, refs.map((r) => r.id).concat(row.guestId));
    // Ask the index what is left rather than assuming the ids we named were all there was.
    const remaining = await deps.vectorIndex.count(namespace);
    if (!remaining.ok) throw new Error(`search index could not confirm the namespace is empty: ${remaining.error.class}`);
    if (remaining.value.count > 0) throw new Error(`biometric vectors remain in ${namespace} after deletion: ${remaining.value.count}`);
    // The result of a biometric operation, cached by the pipeline, is a copy outside this schema.
    const cachedResponsesDeleted = await purgeCachedBiometricResponses(deps.db, row.guestId);
    const consents = await listConsentEntries(deps.db, row.guestId);
    const proof: DeletionProof = {
      identityRefsDeleted: deletedRefs.length,
      providerSubjectsDeleted,
      matchesDeleted: matches.length,
      vectorEntriesDeleted: vectors.ok ? vectors.value.count : 0,
      vectorEntriesRemaining: remaining.value.count,
      cachedResponsesDeleted,
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
    proof: row.proof
      ? {
          identityRefsDeleted: row.proof.identityRefsDeleted,
          matchesDeleted: row.proof.matchesDeleted,
          providerSubjectsDeleted: row.proof.providerSubjectsDeleted,
          cachedResponsesDeleted: row.proof.cachedResponsesDeleted ?? 0,
        }
      : null,
  };
}

export type SweepReason = 'aged_out' | 'consent_not_active';

/**
 * Retention sweep. Two independent reasons a stored template must go:
 *
 *  1. **Age.** The enrolment is older than the retention window. The window runs from enrolment,
 *     which is what the consent text now promises ("12 months after you add your reference
 *     photos") — the two anchors used to disagree.
 *  2. **Consent is no longer active.** Revoked, or superseded because the consent copy changed.
 *     Processing stops the moment a grant stops being current, but storage did not: a guest's
 *     sealed template could sit in the vault for up to a year under a text the site itself
 *     declares superseded. That is the case this loop exists for, and the case its docstring
 *     always claimed to cover while the body only compared timestamps.
 *
 * `requestDeletion` is deduped per guest, so running this every pass is safe and cheap.
 */
export async function sweepRetention(db: Db, opts: { retentionDays: number; now: Date; requestId: string }): Promise<number> {
  return (await sweepRetentionDetailed(db, opts)).length;
}

/** The same sweep, reporting who was swept and why (for the job log and for tests). */
export async function sweepRetentionDetailed(
  db: Db,
  opts: { retentionDays: number; now: Date; requestId: string },
): Promise<{ guestId: string; reason: SweepReason }[]> {
  const cutoff = new Date(opts.now.getTime() - opts.retentionDays * 86_400_000);
  const refs = await db.select().from(biometricIdentityRefs);
  const swept: { guestId: string; reason: SweepReason }[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.guestId)) continue;
    const agedOut = ref.enrolledAt.getTime() <= cutoff.getTime();
    // Age is checked first because it needs no query; consent only when the age check passes it.
    const reason: SweepReason | null = agedOut ? 'aged_out' : hasCurrentConsent(await getConsentState(db, ref.guestId)) ? null : 'consent_not_active';
    if (!reason) continue;
    seen.add(ref.guestId);
    await requestDeletion(db, { guestId: ref.guestId, reason: 'retention', requestedBy: { kind: 'system', component: BIOMETRIC_SWEEP_JOB }, requestId: opts.requestId, now: opts.now });
    swept.push({ guestId: ref.guestId, reason });
  }
  return swept;
}
