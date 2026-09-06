import { LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';
import { err, ok, type Result } from '@/contracts/result';
import { hmacSha256, timingSafeEqualString } from '@/lib/crypto';
import { PREVIEW_TTL_SECONDS } from './constants';

/**
 * Signed lifecycle preview tokens (ADR-0012 §3). An admin mints one (navigate_to with `lifecycle`)
 * and carries it as `?preview=` or the `lifecycle-preview` cookie. Verification alone never grants a
 * preview: `resolveLifecycle` additionally requires an admin principal (`requireAdmin`).
 */
export interface PreviewClaims {
  state: LifecycleState;
  expiresAt: string;
}

export type PreviewFailure = 'malformed' | 'signature' | 'expired' | 'state';

const isState = (v: string): v is LifecycleState => (LIFECYCLE_STATES as readonly string[]).includes(v);

export function mintPreviewToken(state: LifecycleState, secret: string, now: Date, ttlSeconds: number = PREVIEW_TTL_SECONDS): { token: string; expiresAt: string } {
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const payload = `${state}.${exp}`;
  return { token: `${payload}.${hmacSha256(secret, payload)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyPreviewToken(token: string, secret: string, now: Date): Result<PreviewClaims, PreviewFailure> {
  const [state, expRaw, sig] = token.split('.');
  if (!state || !expRaw || !sig) return err('malformed');
  if (!isState(state)) return err('state');
  if (!/^\d{1,12}$/.test(expRaw)) return err('malformed');
  if (!timingSafeEqualString(hmacSha256(secret, `${state}.${expRaw}`), sig)) return err('signature');
  const exp = Number(expRaw);
  if (Math.floor(now.getTime() / 1000) >= exp) return err('expired');
  return ok({ state, expiresAt: new Date(exp * 1000).toISOString() });
}

/** `?preview=RSVP_OPEN` (plain, admins only) or `?preview=RSVP_OPEN.<exp>.<sig>` (signed, admins only). */
export function parsePreviewValue(raw: string | null | undefined, secret: string, now: Date): Result<PreviewClaims, PreviewFailure> {
  const value = raw?.trim();
  if (!value) return err('malformed');
  if (isState(value)) return ok({ state: value, expiresAt: '' });
  return verifyPreviewToken(value, secret, now);
}
