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
  const household = (await db.select().from(households).where(eq(households.id, guest.householdId)).limit(1))[0];
  if (!household) return null;
  const invitation = await currentInvitationForHousehold(db, household.id);
  const selfGuestIds = [...new Set([...selfBindings, ...managerBindings].map((b) => b.guestId))] as GuestId[];
  const managed = await listManagedGuests(db, selfGuestIds);
  const facts = await collectEntitlementFacts(db, { guest, household, invitation });
  const input = {
    guest: { id: guest.id as GuestId, kind: guest.kind, isMinor: guest.isMinor, mergedIntoGuestId: guest.mergedIntoGuestId },
    household: { id: household.id, managerGuestId: household.managerGuestId },
    invitation: invitation ? { lifecycle: invitationLifecycle(invitation, now) } : null,
    bindingRole: primary.role,
    selfGuestIds,
    managedGuestIds: managed.map((m) => m.id as GuestId),
    delegateGuestIds: delegateBindings.map((b) => b.guestId as GuestId),
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
