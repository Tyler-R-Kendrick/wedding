import { hmacSha256, timingSafeEqualString } from '@/lib/crypto';

/**
 * Admin view-role preview: an administrator sees the site with a role's entitlements and navigation,
 * without binding to a real guest's identity or inbox. Synthetic preview records in the database
 * (`preview-personas.ts`) back read capabilities; every mutation is read-only via `viewedBy.readOnly`.
 *
 * Distinct from "Browse as a guest" (`guest-view.ts`), which assumes a specific guest profile.
 */
export const VIEW_ROLE_COOKIE = 'view-role';
export const VIEW_ROLE_TTL_SECONDS = 4 * 60 * 60;

export const VIEW_ROLES = ['guest', 'plus_one', 'household_manager', 'party'] as const;
export type ViewRoleKey = (typeof VIEW_ROLES)[number];

const ROLE_PATTERN = new RegExp(`^(${VIEW_ROLES.join('|')})$`);

const signed = (sessionId: string, payload: string) => `view-role|${sessionId}|${payload}`;

export function mintViewRoleToken(role: ViewRoleKey, sessionId: string, secret: string, now: Date, ttlSeconds: number = VIEW_ROLE_TTL_SECONDS): { token: string; expiresAt: string } {
  if (!ROLE_PATTERN.test(role)) throw new Error('view-role: malformed role');
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const payload = `${role}.${exp}`;
  return { token: `${payload}.${hmacSha256(secret, signed(sessionId, payload))}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** The role this session is previewing, or null for a missing, forged, expired or other-session token. */
export function verifyViewRoleToken(token: string | null | undefined, sessionId: string, secret: string, now: Date): { role: ViewRoleKey } | null {
  if (!token) return null;
  const [role, expRaw, sig, extra] = token.split('.');
  if (!role || !expRaw || !sig || extra !== undefined) return null;
  if (!ROLE_PATTERN.test(role) || !/^\d{1,12}$/.test(expRaw)) return null;
  if (!timingSafeEqualString(hmacSha256(secret, signed(sessionId, `${role}.${expRaw}`)), sig)) return null;
  if (Math.floor(now.getTime() / 1000) >= Number(expRaw)) return null;
  return { role: role as ViewRoleKey };
}

export function viewRoleLabel(role: ViewRoleKey): string {
  switch (role) {
    case 'guest':
      return 'Invited guest';
    case 'plus_one':
      return 'Plus-one';
    case 'household_manager':
      return 'Household manager';
    case 'party':
      return 'Wedding party';
  }
}

export { cookieValue, isAdminSurface } from '@/domain/identity/guest-view';
