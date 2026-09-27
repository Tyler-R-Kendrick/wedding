import { eq, inArray } from 'drizzle-orm';
import type { FlagValues } from '@/contracts/flags';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import { ADMIN_ROLES, type AdminPrincipal, type AdminRole, type GuestPrincipal } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { adminRoles, guests, households, type GuestRow, type HouseholdRow } from '@/db/schema';
import { deriveActsFor, deriveAdminEntitlements, deriveGuestEntitlements } from '@/policy/derive';
import { invitationLifecycle } from './tokens';
import { activeBindingsForIdentity } from './bindings';
import { collectEntitlementFacts } from './facts';
import { currentInvitationForHousehold } from '@/domain/invitations/repo';
import { listManagedGuests } from '@/domain/guests/repo';

export interface SessionFacts {
  authIdentityId: string;
  sessionId: string;
  /** Server-clock time the session last proved possession. */
  authenticatedAt: Date;
  /** Guest the session chose to act as (shared inboxes); falls back to the first self binding. */
  activeGuestId: string | null;
  email: string;
}

/**
 * Builds a GuestPrincipal from a verified session. Returns null when the identity holds no
 * active binding (an unbound identity is anonymous — a session alone entitles nothing).
 */
export async function buildGuestPrincipal(db: Db, session: SessionFacts, flags: FlagValues, now: Date = new Date()): Promise<GuestPrincipal | null> {
  const bindings = await activeBindingsForIdentity(db, session.authIdentityId);
  if (bindings.length === 0) return null;
  const boundGuests = await db.select().from(guests).where(inArray(guests.id, bindings.map((b) => b.guestId)));
  const live = new Map(boundGuests.filter((g) => !g.mergedIntoGuestId).map((g) => [g.id, g] as const));
  const selfBindings = bindings.filter((b) => b.role === 'self' && live.has(b.guestId));
  const managerBindings = bindings.filter((b) => b.role === 'household_manager' && live.has(b.guestId));
  const delegateBindings = bindings.filter((b) => b.role === 'delegate' && live.has(b.guestId));
  const primary =
    (session.activeGuestId && (selfBindings.find((b) => b.guestId === session.activeGuestId) ?? managerBindings.find((b) => b.guestId === session.activeGuestId))) ||
    selfBindings[0] ||
    managerBindings[0] ||
    delegateBindings[0];
  if (!primary) return null;
  const guest = live.get(primary.guestId)!;
  const selfGuestIds = [...new Set([...selfBindings, ...managerBindings].map((b) => b.guestId))] as GuestId[];
  return principalForGuest(db, guest, { bindingRole: primary.role, selfGuestIds, delegateGuestIds: delegateBindings.map((b) => b.guestId as GuestId) }, session, flags, now);
}

/**
 * The GuestPrincipal an administrator browses as ("Browse as a guest", `guest-view.ts`): the one
 * that guest's own sign-in would produce, with `viewedBy` naming the administrator.
 *
 * When the guest is bound to the administrator's own identity (a planner who is also invited, or
 * the couple on their own list) this IS their guest session, so it is built from their bindings
 * exactly as a guest sign-in would be, and it is not read-only. Anyone else's view needs
 * `admin_guest_ops` — the entitlement that already shows an administrator every household in the
 * console — and is built as that guest's own `self` sign-in would be, read-only. Null when the
 * guest is gone (merged or deleted) or the administrator may not view them.
 */
export async function buildGuestViewPrincipal(db: Db, session: SessionFacts, admin: AdminPrincipal, guestId: string, flags: FlagValues, now: Date = new Date()): Promise<GuestPrincipal | null> {
  const viewer = (readOnly: boolean) => ({ adminId: admin.adminId, roles: admin.roles, readOnly });
  const own = await activeBindingsForIdentity(db, session.authIdentityId);
  if (own.some((b) => b.guestId === guestId && b.role !== 'delegate')) {
    const self = await buildGuestPrincipal(db, { ...session, activeGuestId: guestId }, flags, now);
    return self && self.guestId === guestId ? { ...self, viewedBy: viewer(false) } : null;
  }
  if (!admin.entitlements.has('admin_guest_ops')) return null;
  const guest = (await db.select().from(guests).where(eq(guests.id, guestId)).limit(1))[0];
  if (!guest || guest.mergedIntoGuestId) return null;
  const principal = await principalForGuest(db, guest, { bindingRole: 'self', selfGuestIds: [guest.id as GuestId], delegateGuestIds: [] }, session, flags, now);
  return principal ? { ...principal, viewedBy: viewer(true) } : null;
}

async function principalForGuest(
  db: Db,
  guest: GuestRow,
  binding: { bindingRole: 'self' | 'household_manager' | 'delegate'; selfGuestIds: GuestId[]; delegateGuestIds: GuestId[] },
  session: SessionFacts,
  flags: FlagValues,
  now: Date,
): Promise<GuestPrincipal | null> {
  const household = (await db.select().from(households).where(eq(households.id, guest.householdId)).limit(1))[0];
  if (!household) return null;
  const invitation = await currentInvitationForHousehold(db, household.id);
  const managed = await listManagedGuests(db, binding.selfGuestIds);
  const facts = await collectEntitlementFacts(db, { guest, household, invitation });
  const input = {
    guest: { id: guest.id as GuestId, kind: guest.kind, isMinor: guest.isMinor, mergedIntoGuestId: guest.mergedIntoGuestId },
    household: { id: household.id, managerGuestId: household.managerGuestId },
    invitation: invitation ? { lifecycle: invitationLifecycle(invitation, now) } : null,
    bindingRole: binding.bindingRole,
    selfGuestIds: binding.selfGuestIds,
    managedGuestIds: managed.map((m) => m.id as GuestId),
    delegateGuestIds: binding.delegateGuestIds,
    facts,
    flags,
  };
  return {
    kind: 'guest',
    authIdentityId: session.authIdentityId as AuthIdentityId,
    guestId: guest.id as GuestId,
    householdId: household.id as HouseholdId,
    actsFor: deriveActsFor(input),
    entitlements: deriveGuestEntitlements(input),
    authenticatedAt: session.authenticatedAt.toISOString(),
    sessionId: session.sessionId,
  };
}

/** Roles for an email: ADMIN_EMAILS grants owner; admin_roles rows add or override. */
export async function resolveAdminRoles(db: Db, email: string, allowlist: readonly string[]): Promise<Set<AdminRole>> {
  const normalized = email.trim().toLowerCase();
  const roles = new Set<AdminRole>();
  if (allowlist.includes(normalized)) roles.add('owner');
  const rows = await db.select().from(adminRoles).where(eq(adminRoles.email, normalized)).limit(1);
  const row = rows[0];
  if (row && (ADMIN_ROLES as readonly string[]).includes(row.role)) roles.add(row.role);
  return roles;
}

export function buildAdminPrincipal(session: SessionFacts, roles: Set<AdminRole>): AdminPrincipal {
  return {
    kind: 'admin',
    authIdentityId: session.authIdentityId as AuthIdentityId,
    adminId: session.authIdentityId as unknown as AdminId,
    roles,
    entitlements: deriveAdminEntitlements(roles),
    authenticatedAt: session.authenticatedAt.toISOString(),
    sessionId: session.sessionId,
  };
}

export type { GuestRow, HouseholdRow };
