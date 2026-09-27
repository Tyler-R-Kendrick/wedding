import { hmacSha256, timingSafeEqualString } from '@/lib/crypto';

/**
 * "Browse as a guest": an administrator looks at the site the way one guest does.
 *
 * Admins are not guests (ADR-0001): an AdminPrincipal holds no household, so every page that is
 * about "my" weekend, RSVP or table refuses it. This is the one, explicit way through: the console
 * mints a token naming a guest (`admin_browse_as_guest`, which audits it), this browser carries it
 * in a cookie, and the resolver builds that guest's principal with `viewedBy` set.
 *
 * - The token is bound to the administrator's session, so it dies with it: signing out, or the
 *   session expiring, leaves an inert cookie. It carries no role: every request re-resolves the
 *   administrator from the session first, and a token in anyone else's browser is ignored.
 * - The view is read-only unless the guest is the administrator's own guest record
 *   (`buildGuestViewPrincipal`); `authorize` refuses every capability that is not a read.
 * - The console is never viewed as a guest (`isAdminSurface`): its pages and its `admin_*`
 *   capabilities keep the administrator's own principal, so "Back to the console" always works.
 */
export const GUEST_VIEW_COOKIE = 'guest-view';
export const GUEST_VIEW_TTL_SECONDS = 4 * 60 * 60;

const GUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

const signed = (sessionId: string, payload: string) => `guest-view|${sessionId}|${payload}`;

export function mintGuestViewToken(guestId: string, sessionId: string, secret: string, now: Date, ttlSeconds: number = GUEST_VIEW_TTL_SECONDS): { token: string; expiresAt: string } {
  if (!GUEST_ID.test(guestId)) throw new Error('guest-view: malformed guest id');
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const payload = `${guestId}.${exp}`;
  return { token: `${payload}.${hmacSha256(secret, signed(sessionId, payload))}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** The guest this session is browsing as, or null for a missing, forged, expired or other-session token. */
export function verifyGuestViewToken(token: string | null | undefined, sessionId: string, secret: string, now: Date): { guestId: string } | null {
  if (!token) return null;
  const [guestId, expRaw, sig, extra] = token.split('.');
  if (!guestId || !expRaw || !sig || extra !== undefined) return null;
  if (!GUEST_ID.test(guestId) || !/^\d{1,12}$/.test(expRaw)) return null;
  if (!timingSafeEqualString(hmacSha256(secret, signed(sessionId, `${guestId}.${expRaw}`)), sig)) return null;
  if (Math.floor(now.getTime() / 1000) >= Number(expRaw)) return null;
  return { guestId };
}

/**
 * Requests that always see the administrator, never the guest they are browsing as: the console
 * and its capabilities. Everything else — the public pages, the household's pages, `/api/session`
 * that the account menu asks — sees the guest.
 */
export function isAdminSurface(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/capabilities/admin_');
}

/** One cookie's value from a Cookie header. */
export function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
