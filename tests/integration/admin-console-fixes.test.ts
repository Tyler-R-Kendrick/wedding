import { beforeAll, describe, expect, it } from 'vitest';
import { adminUpsertGiftRail } from '@/capabilities/admin_gifts';
import { adminListHouseholds, adminRevokeInvitation } from '@/capabilities/admin_guest_ops';
import { adminAssignTransportationEntitlement, adminRevokeTransportationEntitlement } from '@/capabilities/admin_transport';
import { adminAssignSeats, adminExportRsvp, adminPublishSeating, adminRsvpOverview, adminSeatingOverview, adminUpsertTable } from '@/capabilities/rsvp';
import { newId, type GuestId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { eq } from 'drizzle-orm';
import { eventEntitlements, guests, seatAssignments } from '@/db/schema';
import { mergeGuests } from '@/domain/guests/repo';
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

describe('merging moves a seat, never leaves the duplicate seated', () => {
  it('gives the kept guest the duplicate\'s seat when they have none, and frees it when they do', async () => {
    const audit = { record: async () => undefined } as never;
    const table = expectOk(await run(adminUpsertTable, admin, { name: 'Merge Table', capacity: 6 })).data.id;
    const mk = async (firstName: string) => {
      const id = newId<GuestId>();
      await db.insert(guests).values({ id, householdId: FX.householdB, firstName, lastName: 'Mergetest' });
      return id;
    };
    const seatOf = async (guestId: string) => (await db.select().from(seatAssignments).where(eq(seatAssignments.guestId, guestId)))[0];

    const [keep, dup] = [await mk('Keep'), await mk('Dup')];
    expectOk(await run(adminAssignSeats, admin, { changes: [{ guestId: dup, tableId: table, seatNumber: 3 }] }));
    expect((await mergeGuests(db, { keepId: keep, mergeId: dup, actor: { kind: 'system', component: 'test' }, requestId: 'm1', audit })).ok).toBe(true);
    expect(await seatOf(keep)).toMatchObject({ tableId: table, seatNumber: 3 });
    expect(await seatOf(dup)).toBeUndefined();

    const [keep2, dup2] = [await mk('Keep2'), await mk('Dup2')];
    expectOk(await run(adminAssignSeats, admin, { changes: [{ guestId: keep2, tableId: table, seatNumber: 1 }, { guestId: dup2, tableId: table, seatNumber: 2 }] }));
    expect((await mergeGuests(db, { keepId: keep2, mergeId: dup2, actor: { kind: 'system', component: 'test' }, requestId: 'm2', audit })).ok).toBe(true);
    expect(await seatOf(keep2)).toMatchObject({ seatNumber: 1 });
    expect(await seatOf(dup2)).toBeUndefined();
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
