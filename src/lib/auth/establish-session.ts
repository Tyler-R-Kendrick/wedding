import 'server-only';
import { getWebcryptoSubtle } from '@better-auth/utils';
import { getCookies } from 'better-auth/cookies';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { authSessions, authUsers } from '@/db/schema';
import type { CookieSink } from '@/lib/auth/cookies';
import { getAuth } from '@/lib/auth';
import { AUTH_COOKIE_PREFIX, resolveAuthSecret, SESSION_MAX_AGE_SECONDS, siteOrigin, type WeddingAuth } from '@/lib/auth/config';
import { env } from '@/lib/env';

export interface EstablishedSession {
  sessionToken: string;
  userId: string;
  activeGuestId: string | null;
}

async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await getWebcryptoSubtle().importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await getWebcryptoSubtle().sign('HMAC', key, new TextEncoder().encode(value));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return encodeURIComponent(`${value}.${b64}`);
}

function serializeCookie(name: string, value: string, opt: Record<string, unknown>): string {
  let cookie = `${name}=${value}`;
  if (typeof opt.maxAge === 'number') cookie += `; Max-Age=${Math.floor(opt.maxAge)}`;
  if (opt.path) cookie += `; Path=${opt.path}`;
  if (opt.httpOnly) cookie += '; HttpOnly';
  if (opt.secure) cookie += '; Secure';
  if (opt.sameSite) cookie += `; SameSite=${String(opt.sameSite).charAt(0).toUpperCase()}${String(opt.sameSite).slice(1)}`;
  return cookie;
}

/**
 * Creates a Better Auth session row and appends a signed session cookie to the sink.
 * Used for social sign-in where possession is proven outside the OTP/passkey flows.
 */
export async function establishGuestSession(
  db: Db,
  auth: WeddingAuth,
  sink: CookieSink,
  input: { userId: string; activeGuestId: string | null; headers?: Headers },
): Promise<EstablishedSession | null> {
  const user = (await db.select().from(authUsers).where(eq(authUsers.id, input.userId)).limit(1))[0];
  if (!user) return null;
  const ctx = await auth.$context;
  const now = new Date();
  const session = await ctx.internalAdapter.createSession(input.userId, false, {
    activeGuestId: input.activeGuestId,
    authenticatedAt: now,
  });
  await db.update(authSessions).set({ activeGuestId: input.activeGuestId, authenticatedAt: now }).where(eq(authSessions.token, session.token));

  const baseURL = siteOrigin();
  const secret = resolveAuthSecret();
  const cookies = getCookies({
    baseURL,
    secret,
    advanced: { useSecureCookies: env.isProduction, cookiePrefix: AUTH_COOKIE_PREFIX, defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' } },
    session: { expiresIn: SESSION_MAX_AGE_SECONDS },
  });
  const signed = await signCookieValue(session.token, secret);
  const setCookie = serializeCookie(cookies.sessionToken.name, signed, {
    ...cookies.sessionToken.attributes,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  sink.setCookies.push(setCookie);
  return { sessionToken: session.token, userId: input.userId, activeGuestId: input.activeGuestId };
}

export async function establishGuestSessionAuto(
  db: Db,
  sink: CookieSink,
  input: { userId: string; activeGuestId: string | null; headers?: Headers },
): Promise<EstablishedSession | null> {
  const auth = await getAuth(db);
  return establishGuestSession(db, auth, sink, input);
}
