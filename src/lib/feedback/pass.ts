import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The reporter pass: how the site knows a problem report comes from one of the couple when it
 * cannot ask its own sign-in.
 *
 * The reporter is for Tyler and Sara only, and it has to work when the thing being reported is that
 * sign-in or the database is down. Those two requirements meet here. While an owner is signed in,
 * the site hands their browser this cookie: an HMAC under the site's own secret over their admin id
 * and an expiry. Checking it needs the secret and a clock, nothing else: no session lookup, no
 * database, no provider. Thirty days, renewed on every signed-in visit.
 *
 * What it is worth to someone who steals it: the ability to file a rate-limited problem report. It
 * opens no page and reads nothing. It is cleared on sign-out (the widget asks), and rotating
 * `BETTER_AUTH_SECRET` voids every one.
 *
 * Pure: the secret and the clock are arguments, as in src/lib/stage-access.ts.
 */
export const PASS_SECONDS = 30 * 24 * 60 * 60;
const ADMIN_ID = /^[A-Za-z0-9_-]{6,64}$/;
const TOKEN = /^v1\.([A-Za-z0-9_-]{6,64})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

const sign = (secret: string, adminId: string, expires: number): string => createHmac('sha256', secret).update(`reporter-pass|v1|${adminId}|${expires}`).digest('base64url');

export function mintReporterPass(secret: string, adminId: string, now: number = Date.now()): string | null {
  if (!secret || !ADMIN_ID.test(adminId)) return null;
  const expires = Math.floor(now / 1000) + PASS_SECONDS;
  return `v1.${adminId}.${expires}.${sign(secret, adminId, expires)}`;
}

export function readReporterPass(secret: string | undefined, token: string | null | undefined, now: number = Date.now()): { adminId: string } | null {
  const match = TOKEN.exec(token ?? '');
  if (!secret || !match) return null;
  const [, adminId, expiresText, signature] = match;
  const expires = Number(expiresText);
  if (!adminId || !signature || expires * 1000 <= now) return null;
  const given = Buffer.from(signature);
  const wanted = Buffer.from(sign(secret, adminId, expires));
  return given.length === wanted.length && timingSafeEqual(given, wanted) ? { adminId } : null;
}

/**
 * The signing secret, read straight from the process: the same `BETTER_AUTH_SECRET` the sessions
 * are signed with, or (outside production only) a fixed development value. Not `@/lib/env`, which
 * validates the whole environment and throws when any of it is wrong.
 */
export function reporterPassSecret(source: Record<string, string | undefined> = process.env): string | undefined {
  const secret = source.BETTER_AUTH_SECRET;
  if (secret && secret.length >= 16) return secret;
  return source.NODE_ENV === 'production' ? undefined : 'dev-only-reporter-pass-secret';
}

/** `Set-Cookie` for the pass: httpOnly, same-site, and Secure wherever the site is served over https. */
export function reporterPassCookie(name: string, value: string | null, opts: { secure: boolean }): string {
  const base = `${name}=${value ?? ''}; Path=/; HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`;
  return value ? `${base}; Max-Age=${PASS_SECONDS}` : `${base}; Max-Age=0`;
}
