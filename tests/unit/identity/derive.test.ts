import { describe, expect, it } from 'vitest';
import { readFlags } from '@/contracts/flags';
import type { GuestId } from '@/contracts/ids';
import { ADMIN_ROLE_ENTITLEMENTS, deriveActsFor, deriveAdminEntitlements, deriveGuestEntitlements, type GuestDerivationInput } from '@/policy/derive';

const base = (over: Partial<GuestDerivationInput> = {}): GuestDerivationInput => ({
  guest: { id: 'G1' as GuestId, kind: 'adult', isMinor: false, mergedIntoGuestId: null },
  household: { id: 'H1', managerGuestId: 'G1' },
  invitation: { lifecycle: 'claimed' },
  bindingRole: 'self',
  selfGuestIds: ['G1' as GuestId],
  managedGuestIds: ['G2' as GuestId, 'G3' as GuestId],
  delegateGuestIds: [],
  facts: { invitedEventKeys: ['ceremony', 'reception'], seatingPublished: false, transportEligible: true },
  flags: readFlags({}),
  ...over,
});

describe('deriveGuestEntitlements matrix', () => {
  it('household manager with a claimed invitation holds the full guest set except seating before publish', () => {
    const e = deriveGuestEntitlements(base());
    expect([...e].sort()).toEqual(
      ['claim_transportation_benefit', 'manage_household_rsvp', 'rsvp_self', 'upload_media', 'use_concierge', 'view_event', 'view_private_media', 'view_private_schedule', 'view_travel_tools'].sort(),
    );
    expect(e.has('view_table_assignment')).toBe(false);
  });

  it('grants view_table_assignment only once seating is published', () => {
    const e = deriveGuestEntitlements(base({ facts: { invitedEventKeys: ['ceremony'], seatingPublished: true, transportEligible: false } }));
    expect(e.has('view_table_assignment')).toBe(true);
    expect(e.has('claim_transportation_benefit')).toBe(false);
  });

  it('a plain member (not manager) never manages the household RSVP', () => {
    const e = deriveGuestEntitlements(base({ household: { id: 'H1', managerGuestId: 'G9' }, managedGuestIds: [] }));
    expect(e.has('rsvp_self')).toBe(true);
    expect(e.has('manage_household_rsvp')).toBe(false);
  });

  it('children, minors, and merged duplicates hold nothing', () => {
    expect(deriveGuestEntitlements(base({ guest: { id: 'G1' as GuestId, kind: 'child', isMinor: true, mergedIntoGuestId: null } })).size).toBe(0);
    expect(deriveGuestEntitlements(base({ guest: { id: 'G1' as GuestId, kind: 'adult', isMinor: true, mergedIntoGuestId: null } })).size).toBe(0);
    expect(deriveGuestEntitlements(base({ guest: { id: 'G1' as GuestId, kind: 'adult', isMinor: false, mergedIntoGuestId: 'G7' } })).size).toBe(0);
  });

  it('revoked or expired invitations remove every entitlement; missing invitation too', () => {
    expect(deriveGuestEntitlements(base({ invitation: { lifecycle: 'revoked' } })).size).toBe(0);
    expect(deriveGuestEntitlements(base({ invitation: { lifecycle: 'expired' } })).size).toBe(0);
    expect(deriveGuestEntitlements(base({ invitation: null })).size).toBe(0);
    expect(deriveGuestEntitlements(base({ invitation: { lifecycle: 'active' } })).has('rsvp_self')).toBe(true);
  });

  it('no invited events means no view_event and no private schedule, but travel tools stay', () => {
    const e = deriveGuestEntitlements(base({ facts: { invitedEventKeys: [], seatingPublished: true, transportEligible: true } }));
    expect(e.has('view_event')).toBe(false);
    expect(e.has('view_private_schedule')).toBe(false);
    expect(e.has('view_table_assignment')).toBe(false);
    expect(e.has('view_travel_tools')).toBe(true);
  });

  it('delegates cannot RSVP as the guest or claim their benefits', () => {
    const e = deriveGuestEntitlements(base({ bindingRole: 'delegate', household: { id: 'H1', managerGuestId: 'G9' }, managedGuestIds: [] }));
    expect(e.has('rsvp_self')).toBe(false);
    expect(e.has('claim_transportation_benefit')).toBe(false);
    expect(e.has('view_event')).toBe(true);
  });

  it('follows feature flags for uploads, concierge, transport, and biometrics', () => {
    const flags = readFlags({ FLAG_GUEST_UPLOADS: 'off', FLAG_AI_CONCIERGE: 'off', FLAG_TRANSPORT_BENEFITS: 'off', FLAG_BIOMETRICS_ENABLED: 'on' });
    const e = deriveGuestEntitlements(base({ flags }));
    expect(e.has('upload_media')).toBe(false);
    expect(e.has('use_concierge')).toBe(false);
    expect(e.has('claim_transportation_benefit')).toBe(false);
    expect(e.has('use_face_matching')).toBe(true);
  });

  it('a manager binding role or an explicit managedBy makes a manager even when the household points elsewhere', () => {
    expect(deriveGuestEntitlements(base({ bindingRole: 'household_manager', household: { id: 'H1', managerGuestId: null }, managedGuestIds: [] })).has('manage_household_rsvp')).toBe(true);
    expect(deriveGuestEntitlements(base({ household: { id: 'H1', managerGuestId: null }, managedGuestIds: ['G4' as GuestId] })).has('manage_household_rsvp')).toBe(true);
    expect(deriveGuestEntitlements(base({ household: { id: 'H1', managerGuestId: null }, managedGuestIds: [] })).has('manage_household_rsvp')).toBe(false);
  });
});

describe('deriveActsFor', () => {
  it('unions self, shared-inbox selves, managed guests and delegates without duplicates', () => {
    const acts = deriveActsFor(base({ selfGuestIds: ['G1', 'G5'] as GuestId[], delegateGuestIds: ['G8', 'G2'] as GuestId[] }));
    expect([...acts].sort()).toEqual(['G1', 'G2', 'G3', 'G5', 'G8']);
  });
  it('a plain member acts only for themselves', () => {
    expect(deriveActsFor(base({ managedGuestIds: [] }))).toEqual(['G1']);
  });
});

describe('deriveAdminEntitlements', () => {
  it('owner holds every admin entitlement; planner and moderator are narrower; roles union', () => {
    const owner = deriveAdminEntitlements(['owner']);
    for (const e of ['admin_content', 'admin_guest_ops', 'admin_media', 'admin_ai', 'admin_audit', 'admin_lifecycle', 'admin_integrations']) expect(owner.has(e as never)).toBe(true);
    expect(deriveAdminEntitlements(['moderator']).has('admin_guest_ops')).toBe(false);
    expect(deriveAdminEntitlements(['planner']).has('admin_guest_ops')).toBe(true);
    expect(deriveAdminEntitlements(['planner']).has('admin_media')).toBe(false);
    expect(deriveAdminEntitlements(['planner', 'moderator']).has('admin_media')).toBe(true);
    expect(deriveAdminEntitlements([]).size).toBe(0);
    expect(Object.keys(ADMIN_ROLE_ENTITLEMENTS).sort()).toEqual(['moderator', 'owner', 'planner']);
  });
});
