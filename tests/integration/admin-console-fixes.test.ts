import { beforeAll, describe, expect, it } from 'vitest';
import { adminUpsertGiftRail } from '@/capabilities/admin_gifts';
import { adminListHouseholds, adminRevokeInvitation } from '@/capabilities/admin_guest_ops';
import { adminAssignTransportationEntitlement, adminRevokeTransportationEntitlement } from '@/capabilities/admin_transport';
import { adminExportRsvp, adminPublishSeating, adminRsvpOverview, adminSeatingOverview } from '@/capabilities/rsvp';
import { newId, type GuestId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { eventEntitlements, guests } from '@/db/schema';
import { FX, fixtureAdmin } from '@/db/seed/fixtures';
import { SEED_EVENT_IDS } from '@/domain/events/seed';
import { expectErr, expectOk, run, seedSwarmE } from './helpers/swarm-e';

/** Admin console audit fixes: step-up on the hard-to-undo admin actions, server-side guest lookup
 * for ride benefits, merged duplicates out of the RSVP overview, and list truncation made visible. */
const admin = fixtureAdmin({ entitlements: new Set(['admin_content', 'admin_guest_ops', 'admin_audit', 'admin_lifecycle', 'admin_integrations']) as never });
const staleAdmin = fixtureAdmin({ authenticatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

let db: Db;
let duplicateId: GuestId;

beforeAll(async () => {
  db = await seedSwarmE();
  // A merged-away duplicate of Ada that still has a reception invitation row.
  duplicateId = newId<GuestId>();
  await db.insert(guests).values({ id: duplicateId, householdId: FX.householdA, firstName: 'Adaduplicate', lastName: 'Testhouse', mergedIntoGuestId: FX.guestA1 });
  await db.insert(eventEntitlements).values({ id: newId(), guestId: duplicateId, eventId: SEED_EVENT_IDS.reception, plusOnePolicy: 'none' });
});

describe('step-up on sensitive admin capabilities', () => {
  it.each([
    ['admin_revoke_invitation', adminRevokeInvitation, { invitationId: 'X'.repeat(26), reason: 'leaked' }],
    ['admin_publish_seating', adminPublishSeating, {}],
    ['admin_assign_transportation_entitlement', adminAssignTransportationEntitlement, { guestId: FX.guestA2, householdId: FX.householdA }],
    ['admin_revoke_transportation_entitlement', adminRevokeTransportationEntitlement, { entitlementId: newId() }],
    ['admin_upsert_gift_rail', adminUpsertGiftRail, { rail: 'venmo', handle: '@sara-tyler' }],
  ] as const)('%s asks a stale admin session to step up', async (_name, cap, input) => {
    expect(cap.stepUp).toBe(true);
    const e = expectErr(await run(cap as never, staleAdmin, input));
    expect(e.code).toBe('step_up_required');
  });
});

describe('ride benefit assignment reads the guest record', () => {
  it('refuses an unknown guest and a household that is not the guest’s', async () => {
    expect(expectErr(await run(adminAssignTransportationEntitlement, admin, { guestId: newId(), householdId: FX.householdA })).code).toBe('not_found');
    expect(expectErr(await run(adminAssignTransportationEntitlement, admin, { guestId: FX.guestA2, householdId: FX.householdB })).code).toBe('validation');
    expect(expectErr(await run(adminAssignTransportationEntitlement, admin, { guestId: duplicateId, householdId: FX.householdA })).code).toBe('not_found');
  });

  it('derives minor status from the guest list, not the form', async () => {
    const minor = expectOk(await run(adminAssignTransportationEntitlement, admin, { guestId: FX.guestA3, householdId: FX.householdA, guestIsMinor: false }));
    expect(minor.data.guestIsMinor).toBe(true);
    const adult = expectOk(await run(adminAssignTransportationEntitlement, admin, { guestId: FX.guestA2, householdId: FX.householdA, guestIsMinor: true }));
    expect(adult.data.guestIsMinor).toBe(false);
  });
});

describe('merged duplicates', () => {
  it('are left out of the RSVP overview and export', async () => {
    const o = expectOk(await run(adminRsvpOverview, admin, {}));
    expect(o.data.rows.some((r) => r.guestId === duplicateId)).toBe(false);
    const csv = expectOk(await run(adminExportRsvp, admin, {}));
    expect(csv.data.csv).not.toContain('Adaduplicate');
  });

  it('are not offered for seating', async () => {
    const s = expectOk(await run(adminSeatingOverview, admin, {}));
    expect(s.data.unassigned.some((u) => u.guestId === duplicateId)).toBe(false);
  });
});

describe('admin lists say when they were cut off', () => {
  it('reports truncated only when there are more rows than returned', async () => {
    const all = expectOk(await run(adminListHouseholds, admin, {}));
    expect(all.data.truncated).toBe(false);
    expect(all.data.households.length).toBeGreaterThan(1);
    const one = expectOk(await run(adminListHouseholds, admin, { limit: 1 }));
    expect(one.data.households).toHaveLength(1);
    expect(one.data.truncated).toBe(true);
  });
});
