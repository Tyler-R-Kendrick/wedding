import { and, desc, eq, gt } from 'drizzle-orm';
import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { otpAttempts, type OtpAttemptKind, type OtpAttemptOutcome } from '@/db/schema';
import { sha256Hex } from '@/lib/crypto';

/**
 * OTP abuse controls that sit *in front of* Better Auth's per-code attempt counter:
 *  - per-email and per-IP send limits (rate-limit provider, policy `otp`)
 *  - per-email and per-IP verify limits (policy `otpVerify`)
 *  - a failed-verification lockout: 5 failures within 15 minutes locks the address for 15 minutes
 * Codes are 6 digits and expire after 10 minutes (configured in src/lib/auth/config.ts).
 */
export const OTP_POLICY = {
  digits: 6,
  expiresInSeconds: 10 * 60,
  /** Wrong codes accepted for a single issued OTP before it is discarded (Better Auth). */
  attemptsPerCode: 5,
  lockout: { maxFailures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
} as const;

export function hashOtpIdentifier(value: string): string {
  return sha256Hex(`otp:${value.trim().toLowerCase()}`);
}

export interface LockoutDecision {
  locked: boolean;
  /** ISO time the lock lifts, when locked. */
  until?: string;
  failures: number;
}

/** Pure lockout rule over recent failure timestamps (newest first or any order). */
export function computeLockout(failureTimes: readonly Date[], now: Date, policy = OTP_POLICY.lockout): LockoutDecision {
  const recent = failureTimes.filter((t) => now.getTime() - t.getTime() < policy.windowMs).sort((a, b) => b.getTime() - a.getTime());
  if (recent.length < policy.maxFailures) return { locked: false, failures: recent.length };
  const latest = recent[0]!;
  const until = new Date(latest.getTime() + policy.lockMs);
  if (until.getTime() <= now.getTime()) return { locked: false, failures: recent.length };
  return { locked: true, until: until.toISOString(), failures: recent.length };
}

export async function recordOtpAttempt(
  db: Db,
  input: { emailHash: string; ipHash: string; purpose: string; kind: OtpAttemptKind; outcome: OtpAttemptOutcome; at?: Date },
): Promise<void> {
  await db.insert(otpAttempts).values({ id: newId(), emailHash: input.emailHash, ipHash: input.ipHash, purpose: input.purpose, kind: input.kind, outcome: input.outcome, at: input.at ?? new Date() });
}

/** Lockout state for an email hash from the persisted attempt log. */
export async function getOtpLockout(db: Db, emailHash: string, now: Date = new Date()): Promise<LockoutDecision> {
  const since = new Date(now.getTime() - OTP_POLICY.lockout.windowMs);
  const rows = await db
    .select({ at: otpAttempts.at })
    .from(otpAttempts)
    .where(and(eq(otpAttempts.emailHash, emailHash), eq(otpAttempts.kind, 'verify'), eq(otpAttempts.outcome, 'failed'), gt(otpAttempts.at, since)))
    .orderBy(desc(otpAttempts.at))
    .limit(OTP_POLICY.lockout.maxFailures * 2);
  return computeLockout(rows.map((r) => r.at), now);
}

/** Admin view: recent attempts for an email hash (no codes, no addresses). */
export async function listOtpAttempts(db: Db, filter: { emailHash?: string; limit?: number } = {}) {
  const q = db.select().from(otpAttempts);
  const rows = filter.emailHash ? await q.where(eq(otpAttempts.emailHash, filter.emailHash)).orderBy(desc(otpAttempts.at)).limit(filter.limit ?? 50) : await q.orderBy(desc(otpAttempts.at)).limit(filter.limit ?? 50);
  return rows;
}
