import type { FlagValues } from '@/contracts/flags';
import type { GuestId } from '@/contracts/ids';
import type { AdminRole, Entitlement } from '@/contracts/principal';

/**
 * Entitlement derivation (ADR-0001 rules 5 and 7). Pure and total: everything the resolver
 * knows about a guest goes in, a Set<Entitlement> and an `actsFor` list come out. No I/O,
 * so the matrix is unit-testable and the same rules serve UI, AI, and WebMCP.
 */
export type DerivedGuestKind = 'adult' | 'child' | 'plus_one';
export type DerivedBindingRole = 'self' | 'household_manager' | 'delegate';

export interface EntitlementFacts {
  /** Event keys the household's invitation covers (Swarm E's event_entitlements supersede when registered). */
  invitedEventKeys: readonly string[];
  /** Seating chart published (Swarm E's seating_publications). Draft assignments are never entitled. */
  seatingPublished: boolean;
  /** A transportation entitlement row exists for this guest (Swarm G). */
  transportEligible: boolean;
}

export interface GuestDerivationInput {
  guest: { id: GuestId; kind: DerivedGuestKind; isMinor: boolean; mergedIntoGuestId: string | null };
  household: { id: string; managerGuestId: string | null };
  invitation: { lifecycle: 'active' | 'claimed' | 'expired' | 'revoked' } | null;
  /** Role of the binding that produced this principal. */
  bindingRole: DerivedBindingRole;
  /** Every guest this identity is bound to as `self` (shared inboxes bind several). */
  selfGuestIds: readonly GuestId[];
  /** Guests whose household lists one of `selfGuestIds` as manager, plus guests that name one as `managedByGuestId`. */
  managedGuestIds: readonly GuestId[];
  /** Guests this identity holds a `delegate` binding for. */
  delegateGuestIds: readonly GuestId[];
  facts: EntitlementFacts;
  flags: FlagValues;
}

const invitationUsable = (i: GuestDerivationInput['invitation']) => i !== null && (i.lifecycle === 'active' || i.lifecycle === 'claimed');

export function isHouseholdManager(input: Pick<GuestDerivationInput, 'guest' | 'household' | 'bindingRole' | 'managedGuestIds' | 'selfGuestIds'>): boolean {
  if (input.bindingRole === 'household_manager') return true;
  if (input.household.managerGuestId && input.selfGuestIds.includes(input.household.managerGuestId as GuestId)) return true;
  return input.managedGuestIds.length > 0;
}

export function deriveGuestEntitlements(input: GuestDerivationInput): Set<Entitlement> {
  const out = new Set<Entitlement>();
  const { guest, facts, flags } = input;
  // Merged duplicates and children never hold entitlements of their own (ADR-0001 rule 7).
  if (guest.mergedIntoGuestId || guest.kind === 'child' || guest.isMinor) return out;
  const invited = invitationUsable(input.invitation);
  const manager = isHouseholdManager(input);

  if (invited && facts.invitedEventKeys.length > 0) out.add('view_event');
  if (invited && input.bindingRole !== 'delegate') out.add('rsvp_self');
  if (invited && manager) out.add('manage_household_rsvp');
  if (out.has('view_event')) out.add('view_private_schedule');
  if (out.has('view_event') && facts.seatingPublished) out.add('view_table_assignment');
  if (invited) out.add('view_travel_tools');
  if (invited && flags.TRANSPORT_BENEFITS && facts.transportEligible && input.bindingRole === 'self') out.add('claim_transportation_benefit');
  if (invited && flags.GUEST_UPLOADS) out.add('upload_media');
  if (invited) out.add('view_private_media');
  if (invited && flags.BIOMETRICS_ENABLED) out.add('use_face_matching');
  if (invited && flags.AI_CONCIERGE) out.add('use_concierge');
  return out;
}

/**
 * Who this principal may act for: itself and every other guest bound to the same verified
 * inbox, the household it manages, guests that name it as manager, and delegate bindings.
 * Benefits stay individual: capabilities that redeem something check `principal.guestId`,
 * never `actsFor` (ADR-0001 rule 5).
 */
export function deriveActsFor(input: Pick<GuestDerivationInput, 'guest' | 'selfGuestIds' | 'managedGuestIds' | 'delegateGuestIds'>): GuestId[] {
  const ids = new Set<GuestId>([input.guest.id, ...input.selfGuestIds, ...input.managedGuestIds, ...input.delegateGuestIds]);
  return [...ids];
}

/** Admin roles → entitlements (ADR-0002). Owner holds everything; planner runs guest ops; moderator handles media. */
export const ADMIN_ROLE_ENTITLEMENTS: Record<AdminRole, readonly Entitlement[]> = {
  owner: ['admin_content', 'admin_guest_ops', 'admin_media', 'admin_ai', 'admin_audit', 'admin_lifecycle', 'admin_integrations', 'use_concierge'],
  planner: ['admin_content', 'admin_guest_ops', 'admin_audit', 'admin_lifecycle', 'use_concierge'],
  moderator: ['admin_media', 'admin_audit', 'use_concierge'],
};

export function deriveAdminEntitlements(roles: Iterable<AdminRole>): Set<Entitlement> {
  const out = new Set<Entitlement>();
  for (const role of roles) for (const e of ADMIN_ROLE_ENTITLEMENTS[role] ?? []) out.add(e);
  return out;
}
