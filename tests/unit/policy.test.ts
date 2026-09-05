import { describe, expect, it } from 'vitest';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { assertActsFor, authorize } from '@/policy/entitlements';
import { requireFreshSession } from '@/policy/stepUp';

const guest = (over: Partial<GuestPrincipal> = {}): GuestPrincipal => ({
  kind: 'guest',
  authIdentityId: 'A' as AuthIdentityId,
  guestId: 'G1' as GuestId,
  householdId: 'H1' as HouseholdId,
  actsFor: ['G1' as GuestId],
  entitlements: new Set(['view_event', 'rsvp_self']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's',
  ...over,
});

const admin = (over: Partial<AdminPrincipal> = {}): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD1' as AdminId,
  roles: new Set(['planner']),
  entitlements: new Set(['admin_content']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's',
  ...over,
});

const anonymous: Principal = { kind: 'anonymous' };
const system: Principal = { kind: 'system', component: 'test' };

describe('authorize', () => {
  it('denies anonymous callers of guest capabilities with unauthenticated', () => {
    const r = authorize({ name: 'x', auth: 'guest', requires: [] }, anonymous);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unauthenticated');
  });

  it('denies a guest missing an entitlement with forbidden and lists what is missing', () => {
    const r = authorize({ name: 'x', auth: 'guest', requires: ['manage_household_rsvp'] }, guest());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('forbidden');
      expect(r.error.details?.missing).toEqual(['manage_household_rsvp']);
    }
  });

  it('allows when auth level and entitlements are satisfied', () => {
    expect(authorize({ name: 'x', auth: 'guest', requires: ['rsvp_self'] }, guest()).ok).toBe(true);
    expect(authorize({ name: 'x', auth: 'anonymous', requires: [] }, anonymous).ok).toBe(true);
    expect(authorize({ name: 'x', auth: 'admin', requires: ['admin_content'] }, admin()).ok).toBe(true);
    expect(authorize({ name: 'x', auth: 'system', requires: ['admin_audit'] }, system).ok).toBe(true);
  });

  it('keeps guests out of admin and system levels', () => {
    expect(authorize({ name: 'x', auth: 'admin', requires: [] }, guest()).ok).toBe(false);
    expect(authorize({ name: 'x', auth: 'system', requires: [] }, admin()).ok).toBe(false);
  });
});

describe('assertActsFor', () => {
  it('lets a guest act only for guests in actsFor', () => {
    expect(assertActsFor(guest(), 'G1' as GuestId).ok).toBe(true);
    const r = assertActsFor(guest(), 'G2' as GuestId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('forbidden');
    expect(assertActsFor(guest({ actsFor: ['G1' as GuestId, 'G2' as GuestId] }), 'G2' as GuestId).ok).toBe(true);
  });

  it('requires admin_guest_ops for admins and always allows system', () => {
    expect(assertActsFor(admin(), 'G1' as GuestId).ok).toBe(false);
    expect(assertActsFor(admin({ entitlements: new Set(['admin_guest_ops']) }), 'G1' as GuestId).ok).toBe(true);
    expect(assertActsFor(system, 'G1' as GuestId).ok).toBe(true);
    expect(assertActsFor(anonymous, 'G1' as GuestId).ok).toBe(false);
  });
});

describe('step-up', () => {
  it('accepts fresh sessions and rejects stale ones', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    expect(requireFreshSession(guest({ authenticatedAt: '2026-09-05T11:58:00Z' }), now).ok).toBe(true);
    const stale = requireFreshSession(guest({ authenticatedAt: '2026-09-05T11:00:00Z' }), now);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('step_up_required');
    expect(requireFreshSession(system, now).ok).toBe(true);
    expect(requireFreshSession(anonymous, now).ok).toBe(false);
  });
});
