import 'server-only';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

/**
 * The OTP challenge travels between "send code" and "verify code" in a short-lived HttpOnly
 * cookie instead of the URL, so it never lands in history, referrers or logs (review N6).
 * The value is opaque (the challenge is a random nonce + HMAC) plus non-sensitive display hints.
 */
export const CHALLENGE_COOKIE = 'wedding.challenge';
const MAX_AGE_SECONDS = 10 * 60;

export interface ChallengeCookie {
  c: string;
  /** Masked address the code went to ("t•••@g•••.com"). */
  to?: string;
  /** Person whose inbox was used when a household manager claims for someone. */
  for?: string;
  /** Where "send a new code" returns to (already validated as a safe path). */
  back?: string;
  /** Email being confirmed (change-email flow only). */
  email?: string;
  kind: 'claim' | 'sign_in' | 'admin_sign_in' | 'step_up' | 'change_email';
}

export async function setChallengeCookie(data: ChallengeCookie): Promise<void> {
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, Buffer.from(JSON.stringify(data), 'utf8').toString('base64url'), { httpOnly: true, sameSite: 'lax', secure: env.isProduction, path: '/', maxAge: MAX_AGE_SECONDS });
}

export async function readChallengeCookie(): Promise<ChallengeCookie | null> {
  try {
    const raw = (await cookies()).get(CHALLENGE_COOKIE)?.value;
    if (!raw || raw.length > 4096) return null;
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as ChallengeCookie;
    return typeof parsed?.c === 'string' && typeof parsed.kind === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearChallengeCookie(): Promise<void> {
  try {
    (await cookies()).delete(CHALLENGE_COOKIE);
  } catch {
    // read-only cookie store (RSC render)
  }
}
