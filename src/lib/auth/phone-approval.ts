import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizePhoneE164 } from '@/domain/identity/phone';

/**
 * A phone code is checked with Twilio exactly once. Twilio deletes a verification as soon as it is
 * approved, so a second check of the same code answers 404 and reads as a wrong code. Phone
 * sign-in checks the code itself (it owns the lockout and the audit log) and then asks Better Auth
 * for the session; Better Auth's `verifyOTP` hook reads the approval from here instead of asking
 * Twilio again. The approval lives only for that one call chain, so nothing else can reuse it, and
 * Better Auth's own phone routes are disabled over HTTP (`DISABLED_AUTH_PATHS`).
 */
const approved = new AsyncLocalStorage<{ to: string; code: string }>();

const phoneKey = (to: string) => normalizePhoneE164(to) ?? to;

export function withApprovedPhoneCode<T>(to: string, code: string, fn: () => Promise<T>): Promise<T> {
  return approved.run({ to: phoneKey(to), code }, fn);
}

export function phoneCodeApproved(to: string, code: string): boolean {
  const a = approved.getStore();
  return !!a && a.to === phoneKey(to) && a.code === code;
}
