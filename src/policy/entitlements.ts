import type { AnyCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import type { GuestId } from '@/contracts/ids';
import { hasEntitlement, type Entitlement, type Principal } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';

const SIGN_IN_MESSAGE = 'Please sign in to continue.';
const FORBIDDEN_MESSAGE = 'You do not have access to that.';

/** Auth-level check: who may even attempt this capability. */
export function meetsAuthLevel(auth: AnyCapability['auth'], p: Principal): boolean {
  switch (auth) {
    case 'anonymous':
      return true;
    case 'guest':
      return p.kind === 'guest' || p.kind === 'admin' || p.kind === 'system';
    case 'admin':
      return p.kind === 'admin' || p.kind === 'system';
    case 'system':
      return p.kind === 'system';
  }
}

export function missingEntitlements(required: readonly Entitlement[], p: Principal): Entitlement[] {
  return required.filter((e) => !hasEntitlement(p, e));
}

/**
 * Server-side authorization for a capability descriptor. Hidden UI is never authorization;
 * this runs on every invocation regardless of surface.
 */
export function authorize(descriptor: Pick<AnyCapability, 'auth' | 'requires' | 'name'>, principal: Principal): Result<void, CapabilityError> {
  if (!meetsAuthLevel(descriptor.auth, principal)) {
    if (principal.kind === 'anonymous') return err(new CapabilityError('unauthenticated', SIGN_IN_MESSAGE));
    return err(new CapabilityError('forbidden', FORBIDDEN_MESSAGE));
  }
  const missing = missingEntitlements(descriptor.requires, principal);
  if (missing.length > 0) {
    return err(new CapabilityError('forbidden', FORBIDDEN_MESSAGE, { missing }));
  }
  return ok(undefined);
}

/**
 * Ownership: may this principal act for `guestId`? Guests act for themselves and, when
 * household managers, for their household. Admins need `admin_guest_ops`. System always may.
 * Handlers call this before touching any guest-owned row.
 */
export function assertActsFor(principal: Principal, guestId: GuestId): Result<void, CapabilityError> {
  switch (principal.kind) {
    case 'system':
      return ok(undefined);
    case 'admin':
      return principal.entitlements.has('admin_guest_ops')
        ? ok(undefined)
        : err(new CapabilityError('forbidden', FORBIDDEN_MESSAGE));
    case 'guest':
      return principal.actsFor.includes(guestId)
        ? ok(undefined)
        : err(new CapabilityError('forbidden', 'You can only manage your own household.'));
    case 'anonymous':
      return err(new CapabilityError('unauthenticated', SIGN_IN_MESSAGE));
  }
}

export const canActFor = (principal: Principal, guestId: GuestId): boolean => assertActsFor(principal, guestId).ok;
