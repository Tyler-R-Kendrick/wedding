import { count, desc, eq } from 'drizzle-orm';
import type { FeatureFlag, FlagValues } from '@/contracts/flags';
import type { Db } from '@/db/client';
import { biometricConsents, biometricDeletions, biometricIdentityRefs, biometricMatches } from '@/db/schema/biometrics';
import { countConsents, consentState } from './consent';
import { countDeletions } from './deletion';
import { readinessNote } from '@/lib/flags';
import { CONSENT_POLICY_VERSION, CONSENT_TEXT_HASH } from './policy';

export interface BiometricStatus {
  flag: boolean;
  readiness: boolean;
  /** Both on: the feature can actually run (subject to per-guest consent). */
  enabled: boolean;
  policy: { version: string; textHash: string; counselReviewed: false };
  consents: { grants: number; revokes: number; active: number; superseded: number };
  enrolments: number;
  matches: number;
  deletions: Record<string, number>;
  provider: { name: string; mode: string };
  vaultKeySource: 'env' | 'derived' | 'missing';
  /** What the live readiness switch rests on, as recorded when it was flipped. */
  counselReviewRef: string | null;
}

/** Counts for the admin biometrics page. Never returns a template, a hash of one, or an IP hash. */
export async function computeBiometricStatus(db: Db, input: { flags: FlagValues; readiness: (flag: FeatureFlag) => Promise<boolean>; provider: { name: string; mode: string }; vaultKeySource: BiometricStatus['vaultKeySource'] }): Promise<BiometricStatus> {
  const flag = input.flags.BIOMETRICS_ENABLED;
  const readiness = await input.readiness('BIOMETRICS_ENABLED');
  const counselReviewRef = await readinessNote('BIOMETRICS_ENABLED', db);
  const totals = await countConsents(db);
  const rows = await db.select().from(biometricConsents).orderBy(desc(biometricConsents.createdAt));
  const byGuest = new Map<string, typeof rows>();
  for (const r of rows) byGuest.set(r.guestId, [...(byGuest.get(r.guestId) ?? []), r]);
  let active = 0;
  let superseded = 0;
  for (const list of byGuest.values()) {
    const s = consentState(list);
    if (s.status === 'active') active++;
    if (s.status === 'superseded') superseded++;
  }
  const enrolments = Number((await db.select({ n: count() }).from(biometricIdentityRefs))[0]?.n ?? 0);
  const matches = Number((await db.select({ n: count() }).from(biometricMatches))[0]?.n ?? 0);
  const deletions = await countDeletions(db);
  return {
    flag,
    readiness,
    enabled: flag && readiness,
    policy: { version: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, counselReviewed: false },
    consents: { ...totals, active, superseded },
    enrolments,
    matches,
    deletions,
    provider: input.provider,
    vaultKeySource: input.vaultKeySource,
    counselReviewRef,
  };
}

export async function latestDeletions(db: Db, limit = 20) {
  return db.select().from(biometricDeletions).orderBy(desc(biometricDeletions.requestedAt)).limit(limit);
}

export async function guestHasBiometricData(db: Db, guestId: string): Promise<boolean> {
  const refs = await db.select({ n: count() }).from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, guestId));
  const m = await db.select({ n: count() }).from(biometricMatches).where(eq(biometricMatches.guestId, guestId));
  return Number(refs[0]?.n ?? 0) > 0 || Number(m[0]?.n ?? 0) > 0;
}
