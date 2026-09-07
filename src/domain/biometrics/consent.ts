import { asc, count, eq } from 'drizzle-orm';
import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { biometricConsents, type BiometricConsentRow } from '@/db/schema/biometrics';
import { CONSENT_POLICY_VERSION, CONSENT_TEXT_HASH, currentConsentPolicy } from './policy';

/**
 * Append-only consent ledger. Pure state derivation (`consentState`) plus two writers that only
 * ever INSERT. A grant is current when it is the latest grant, has no revoke entry, and was given
 * for the current policy version and text hash.
 */
export type ConsentStatus = 'none' | 'active' | 'revoked' | 'superseded';

export interface ConsentState {
  status: ConsentStatus;
  /** The grant row the status refers to (latest grant), when any. */
  grant: BiometricConsentRow | null;
  revokedAt: string | null;
  /** True when a grant exists for an older policy version or different text (must re-consent). */
  supersededBy?: { version: string };
}

export function consentState(rows: readonly BiometricConsentRow[], policy = { version: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH }): ConsentState {
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const grants = ordered.filter((r) => r.entry === 'grant');
  const latest = grants[grants.length - 1];
  if (!latest) return { status: 'none', grant: null, revokedAt: null };
  const revoke = ordered.find((r) => r.entry === 'revoke' && r.grantId === latest.id);
  if (revoke) return { status: 'revoked', grant: latest, revokedAt: (revoke.revokedAt ?? revoke.createdAt).toISOString() };
  // The grant's own closure stamp counts too, so the derivation can never disagree with the
  // one-open-grant index that is scoped to it.
  if (latest.revokedAt) return { status: 'revoked', grant: latest, revokedAt: latest.revokedAt.toISOString() };
  if (latest.policyVersion !== policy.version || latest.textHash !== policy.textHash) {
    return { status: 'superseded', grant: latest, revokedAt: null, supersededBy: { version: policy.version } };
  }
  return { status: 'active', grant: latest, revokedAt: null };
}

export const hasCurrentConsent = (state: ConsentState): boolean => state.status === 'active';

export async function listConsentEntries(db: Db, guestId: string): Promise<BiometricConsentRow[]> {
  return db.select().from(biometricConsents).where(eq(biometricConsents.guestId, guestId)).orderBy(asc(biometricConsents.createdAt), asc(biometricConsents.id));
}

export async function getConsentState(db: Db, guestId: string): Promise<ConsentState> {
  return consentState(await listConsentEntries(db, guestId));
}

export interface GrantInput {
  guestId: string;
  householdId: string;
  /** Must equal the current policy's hash: the guest confirms the exact text they saw. */
  textHash: string;
  policyVersion: string;
  adultAttested: boolean;
  ipHash: string | null;
  surface: string;
  requestId: string;
  now: Date;
}

export type GrantRefusal = 'policy_mismatch' | 'adult_attestation_required' | 'already_active';

/** Appends a grant entry for the current policy. Never updates an existing row. */
export async function grantConsent(db: Db, input: GrantInput): Promise<{ ok: true; row: BiometricConsentRow } | { ok: false; reason: GrantRefusal }> {
  const policy = currentConsentPolicy();
  if (input.policyVersion !== policy.version || input.textHash !== policy.textHash) return { ok: false, reason: 'policy_mismatch' };
  if (!input.adultAttested) return { ok: false, reason: 'adult_attestation_required' };
  const state = await getConsentState(db, input.guestId);
  if (state.status === 'active') return { ok: false, reason: 'already_active' };
  // The read above cannot be trusted on its own: two tabs both see "none" and both insert. The
  // partial unique index (guest, policy version, text hash) WHERE entry = 'grant' is what actually
  // decides, and the loser is told what the winner already established.
  const [row] = await db
    .insert(biometricConsents)
    .values({
      id: newId(),
      guestId: input.guestId,
      householdId: input.householdId,
      entry: 'grant',
      grantId: null,
      policyVersion: policy.version,
      textHash: policy.textHash,
      text: policy.text,
      purpose: policy.purpose,
      term: policy.term,
      retention: policy.retention,
      providerDisclosure: policy.providerDisclosure,
      scope: 'self_match',
      adultAttested: true,
      ipHash: input.ipHash,
      surface: input.surface,
      requestId: input.requestId,
      grantedAt: input.now,
      revokedAt: null,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning();
  // The unique index on open grants decided; the loser is told what the winner established.
  if (!row) return { ok: false, reason: 'already_active' };
  return { ok: true, row };
}

/**
 * Withdraws consent. Appends a `revoke` ENTRY for every grant this guest still holds open — not
 * only the latest — so a ledger that somehow contains more than one can never keep an
 * un-withdrawable grant, and closes each grant row by stamping its `revoked_at` (the marker the
 * one-open-grant index is scoped to). No-op when nothing is open.
 */
export async function revokeConsent(db: Db, input: { guestId: string; ipHash: string | null; surface: string; requestId: string; now: Date }): Promise<{ revoked: boolean; grant: BiometricConsentRow | null }> {
  const entries = await listConsentEntries(db, input.guestId);
  const revokedGrantIds = new Set(entries.filter((r) => r.entry === 'revoke' && r.grantId).map((r) => r.grantId!));
  const open = entries.filter((r) => r.entry === 'grant' && !revokedGrantIds.has(r.id) && !r.revokedAt);
  const latest = open[open.length - 1] ?? entries.filter((r) => r.entry === 'grant').pop() ?? null;
  if (open.length === 0) return { revoked: false, grant: latest };
  for (const g of open) {
    await db.insert(biometricConsents).values({
      id: newId(),
      guestId: g.guestId,
      householdId: g.householdId,
      entry: 'revoke',
      grantId: g.id,
      policyVersion: g.policyVersion,
      textHash: g.textHash,
      text: g.text,
      purpose: g.purpose,
      term: g.term,
      retention: g.retention,
      providerDisclosure: g.providerDisclosure,
      scope: g.scope,
      adultAttested: g.adultAttested,
      ipHash: input.ipHash,
      surface: input.surface,
      requestId: input.requestId,
      grantedAt: null,
      revokedAt: input.now,
      createdAt: input.now,
    });
    await db.update(biometricConsents).set({ revokedAt: input.now }).where(eq(biometricConsents.id, g.id));
  }
  return { revoked: true, grant: open[open.length - 1]! };
}

export async function countConsents(db: Db): Promise<{ grants: number; revokes: number }> {
  const rows = await db.select({ entry: biometricConsents.entry, n: count() }).from(biometricConsents).groupBy(biometricConsents.entry);
  const by = Object.fromEntries(rows.map((r) => [r.entry, Number(r.n)]));
  return { grants: by['grant'] ?? 0, revokes: by['revoke'] ?? 0 };
}

/** Guest-facing projection of a ledger row: no ip hash, no request id. */
export function describeConsent(row: BiometricConsentRow) {
  return {
    id: row.id,
    policyVersion: row.policyVersion,
    textHash: row.textHash,
    scope: row.scope,
    grantedAt: row.grantedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
