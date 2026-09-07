import { eq } from 'drizzle-orm';
import type { AuditSink } from '@/contracts/audit';
import { READINESS_GATED, readFlags, type FeatureFlag, type FlagValues } from '@/contracts/flags';
import type { PrincipalRef } from '@/contracts/principal';
import { getDb, type Db } from '@/db/client';
import { featureFlags } from '@/db/schema';

export { readFlags, READINESS_GATED };

/** Flag values from the process environment (production-safe defaults). */
export function getFlags(source: Record<string, string | undefined> = process.env): FlagValues {
  return readFlags(source);
}

const READINESS_CACHE_TTL_MS = 10_000;
const cache = new Map<FeatureFlag, { value: boolean; expiresAt: number }>();

export function invalidateReadinessCache(): void {
  cache.clear();
}

/** Persisted readiness switch (admin + legal sign-off) for READINESS_GATED flags. Cached briefly. */
export async function isReady(flag: FeatureFlag, db?: Db): Promise<boolean> {
  const hit = cache.get(flag);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const conn = db ?? (await getDb());
  const rows = await conn.select({ readiness: featureFlags.readiness }).from(featureFlags).where(eq(featureFlags.name, flag)).limit(1);
  const value = rows[0]?.readiness === true;
  cache.set(flag, { value, expiresAt: Date.now() + READINESS_CACHE_TTL_MS });
  return value;
}

/** env flag AND (not readiness-gated OR readiness row true). */
export async function isEnabled(flag: FeatureFlag, opts: { flags?: FlagValues; db?: Db } = {}): Promise<boolean> {
  const flags = opts.flags ?? getFlags();
  if (!flags[flag]) return false;
  if (!READINESS_GATED.includes(flag)) return true;
  return isReady(flag, opts.db);
}

/**
 * Admin mutation: flips the readiness row and audits it. Callers authorize first.
 * `note` records what authorises the switch (for BIOMETRICS_ENABLED, the counsel review) on the
 * row itself; switching off clears it, so a stale reference can never appear to justify a live gate.
 */
export async function setReadiness(
  db: Db,
  input: { flag: FeatureFlag; ready: boolean; actor: PrincipalRef; requestId: string; audit: AuditSink; note?: string },
): Promise<void> {
  const now = new Date();
  const note = input.ready ? (input.note?.trim() || null) : null;
  await db
    .insert(featureFlags)
    .values({ name: input.flag, readiness: input.ready, note, updatedBy: input.actor, updatedAt: now })
    .onConflictDoUpdate({ target: featureFlags.name, set: { readiness: input.ready, note, updatedBy: input.actor, updatedAt: now } });
  cache.delete(input.flag);
  await input.audit.record({
    actor: input.actor,
    action: 'flag.changed',
    target: { type: 'feature_flag', id: input.flag },
    outcome: 'success',
    requestId: input.requestId,
    metadata: { readiness: input.ready, ...(note ? { note } : {}) },
  });
}

/** The recorded justification for a readiness switch, when there is one. */
export async function readinessNote(flag: FeatureFlag, db: Db): Promise<string | null> {
  const rows = await db.select({ note: featureFlags.note, readiness: featureFlags.readiness }).from(featureFlags).where(eq(featureFlags.name, flag)).limit(1);
  return rows[0]?.readiness ? (rows[0]?.note ?? null) : null;
}
