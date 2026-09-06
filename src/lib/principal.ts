import { CapabilityError } from '@/contracts/errors';
import type { AdminPrincipal, AdminRole, GuestPrincipal, Principal, SystemPrincipal } from '@/contracts/principal';

/**
 * Who is making this request? The auth swarm installs a Better Auth-backed resolver via
 * `setPrincipalResolver`; until then every browser request is anonymous. System principals
 * are only ever constructed server-side (jobs, cron), never from a request.
 */
export interface PrincipalResolver {
  resolve(request: Request): Promise<Principal>;
}

export const ANONYMOUS: Principal = { kind: 'anonymous' };

export const anonymousResolver: PrincipalResolver = {
  async resolve() {
    return ANONYMOUS;
  },
};

const g = globalThis as unknown as { __weddingPrincipalResolver?: PrincipalResolver };

export function setPrincipalResolver(resolver: PrincipalResolver): void {
  g.__weddingPrincipalResolver = resolver;
}

export function getPrincipalResolver(): PrincipalResolver {
  return g.__weddingPrincipalResolver ?? anonymousResolver;
}

export async function getPrincipal(request: Request): Promise<Principal> {
  try {
    return await getPrincipalResolver().resolve(request);
  } catch {
    // A broken session must degrade to anonymous, never to elevated access.
    return ANONYMOUS;
  }
}

export const systemPrincipal = (component: string): SystemPrincipal => ({ kind: 'system', component });

/** Narrow to an admin (optionally holding one of `roles`) or throw a guest-safe CapabilityError. */
export function requireAdmin(p: Principal, roles?: readonly AdminRole[]): AdminPrincipal {
  if (p.kind === 'anonymous') throw new CapabilityError('unauthenticated', 'Please sign in to continue.');
  if (p.kind !== 'admin') throw new CapabilityError('forbidden', 'You do not have access to that.');
  if (roles && roles.length > 0 && !roles.some((r) => p.roles.has(r))) {
    throw new CapabilityError('forbidden', 'You do not have access to that.');
  }
  return p;
}

/** Narrow to a signed-in guest or throw. Admins are not guests: use previewAs for previews. */
export function requireGuest(p: Principal): GuestPrincipal {
  if (p.kind === 'anonymous') throw new CapabilityError('unauthenticated', 'Please sign in to continue.');
  if (p.kind !== 'guest') throw new CapabilityError('forbidden', 'This area is for invited guests.');
  return p;
}
