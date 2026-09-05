import type { Db } from '@/db/client';
import type { SessionFacts } from '@/domain/identity/principal';
import { getAuth } from './index';

export interface AuthSession {
  session: { id: string; token: string; userId: string; createdAt: Date; expiresAt: Date; authenticatedAt?: Date | string | null; activeGuestId?: string | null };
  user: { id: string; email: string; name: string; emailVerified: boolean };
}

/**
 * Reads the Better Auth session for a request. `disableRefresh` keeps React Server Component
 * renders side-effect free (cookies cannot be written there); actions and route handlers refresh.
 */
export async function getAuthSession(headers: Headers, opts: { db?: Db; disableRefresh?: boolean } = {}): Promise<AuthSession | null> {
  const auth = await getAuth(opts.db);
  const result = (await auth.api.getSession({ headers, query: opts.disableRefresh ? { disableRefresh: true } : undefined })) as AuthSession | null;
  return result ?? null;
}

export function toSessionFacts(s: AuthSession): SessionFacts {
  const raw = s.session.authenticatedAt;
  const authenticatedAt = raw ? new Date(raw) : s.session.createdAt;
  return {
    authIdentityId: s.session.userId,
    sessionId: s.session.id,
    authenticatedAt: Number.isFinite(authenticatedAt.getTime()) ? authenticatedAt : s.session.createdAt,
    activeGuestId: s.session.activeGuestId ?? null,
    email: s.user.email,
  };
}
