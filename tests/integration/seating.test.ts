import { beforeAll, describe, expect, it } from 'vitest';
import { adminAssignSeats, adminDeleteTable, adminImportSeatingCsv, adminPublishSeating, adminSeatingOverview, adminUnpublishSeating, adminUpsertTable, getMyItinerary, getMyRsvp, getMyTable, listMyEvents, showMyTableOnFloorplan } from '@/capabilities/rsvp';
import type { Db } from '@/db/client';
import { FX, fixtureAdmin, fixturePrincipal } from '@/db/seed/fixtures';
import { listAuditEvents } from '@/lib/audit';
import { expectErr, expectOk, run, seedSwarmE } from './helpers/swarm-e';

const A1 = fixturePrincipal('A1');
const A2 = fixturePrincipal('A2');
const B1 = fixturePrincipal('B1');
const admin = fixtureAdmin();
let db: Db;
let tableA: string;
let tableB: string;
let planId: string;

beforeAll(async () => {
  db = await seedSwarmE();
});

/** Every guest-facing capability, serialized, so a draft id can be searched for. */
async function everyGuestResponse(principal: typeof A1) {
  const out = await Promise.all([run(getMyItinerary, principal, {}), run(getMyTable, principal, {}), run(showMyTableOnFloorplan, principal, {}), run(listMyEvents, principal, {}), run(getMyRsvp, principal, {})]);
  return JSON.stringify(out);
}

describe('draft seating never reaches guests', () => {
  it('builds a draft chart (tables, assignments, CSV) that stays invisible until publish', async () => {
    const plans = expectOk(await run(adminSeatingOverview, admin, {}));
    expect(plans.data.floorPlans.map((p) => p.venueSpaceRef).sort()).toEqual(['madison-ballroom', 'stagg-court', 'the-tank', 'white-city-ballroom']);
    expect(plans.data.floorPlans.every((p) => p.placeholder)).toBe(true);
    planId = plans.data.floorPlans.find((p) => p.venueSpaceRef === 'white-city-ballroom')!.id;

    tableA = expectOk(await run(adminUpsertTable, admin, { name: 'Draft Table Alpha', capacity: 3, floorPlanId: planId, anchorId: 't1' })).data.id;
    tableB = expectOk(await run(adminUpsertTable, admin, { name: 'Draft Table Beta', capacity: 8 })).data.id;
    expect(expectErr(await run(adminUpsertTable, admin, { name: 'Bad anchor', capacity: 8, floorPlanId: planId, anchorId: 'nope' })).code).toBe('validation');

    expectOk(await run(adminAssignSeats, admin, { changes: [{ guestId: FX.guestA1, tableId: tableA, seatNumber: 1 }, { guestId: FX.guestA2, tableId: tableA, seatNumber: 2 }, { guestId: FX.guestB1, tableId: tableB, seatNumber: 1 }] }));
    const over = expectErr(await run(adminAssignSeats, admin, { changes: [{ guestId: FX.guestA3, tableId: tableA }, { guestId: FX.guestC1, tableId: tableA }] }));
    expect(over.code).toBe('conflict');

    const csv = expectOk(await run(adminImportSeatingCsv, admin, { csv: 'table,seat,guest\nDraft Table Beta,2,Eve Fixture\nDraft Table Gamma,1,Fin Solo\n' }));
    expect(csv.data).toMatchObject({ applied: 2, createdTables: ['Draft Table Gamma'], errors: [], unresolved: [] });
    const unresolved = expectOk(await run(adminImportSeatingCsv, admin, { csv: 'Draft Table Beta,3,Nobody Here\n' }));
    expect(unresolved.data.unresolved).toEqual([{ line: 1, guest: 'Nobody Here' }]);
    expect(unresolved.data.applied).toBe(0);
    const bad = expectOk(await run(adminImportSeatingCsv, admin, { csv: 'Draft Table Beta,zz,Eve Fixture\n' }));
    expect(bad.data.errors[0]).toMatchObject({ line: 1 });

    const overview = expectOk(await run(adminSeatingOverview, admin, {}));
    expect(overview.data.publication).toBeNull();
    expect(overview.data.draftDiffers).toBe(true);
    expect(overview.data.tables.map((t) => t.name)).toEqual(['Draft Table Alpha', 'Draft Table Beta', 'Draft Table Gamma']);
    expect(overview.data.unassigned.map((u) => u.guestId)).toEqual([FX.guestA3]);
  });

  it('answers not_found before publication and leaks no draft ids or names anywhere', async () => {
    const table = expectErr(await run(getMyTable, A1, {}));
    expect(table.code).toBe('not_found');
    expect(expectErr(await run(showMyTableOnFloorplan, A1, {})).code).toBe('not_found');
    const itinerary = expectOk(await run(getMyItinerary, A1, {}));
    expect(itinerary.data.seating).toMatchSnapshot();
    const all = await everyGuestResponse(A1);
    expect(all).not.toContain(tableA);
    expect(all).not.toContain(tableB);
    expect(all).not.toContain('Draft Table');
    expect(all).not.toContain('seatNumber');
  });
});

describe('published seating', () => {
  it('publishes a frozen snapshot, audited; guests see only that snapshot', async () => {
    const pub = expectOk(await run(adminPublishSeating, admin, { note: 'v1' }, { requestId: 'req-pub-1' }));
    expect(pub.data).toMatchObject({ tables: 3, seated: 5 });
    expect((await listAuditEvents(db, { requestId: 'req-pub-1', action: 'seating.published' }))[0]).toMatchObject({ targetId: pub.data.publicationId, metadata: { tables: 3, seated: 5 } });

    const mine = expectOk(await run(getMyTable, A1, {}));
    expect(mine.data.table).toEqual({ id: tableA, name: 'Draft Table Alpha', seatNumber: 1, anchorId: 't1', tablemates: ['Ben Testhouse'] });
    expect(mine.data.floorPlan).toMatchObject({ id: planId, venueSpaceRef: 'white-city-ballroom', placeholder: true });
    expect(mine.sources[0]).toMatchObject({ title: 'Seating chart (published)', recordRef: { type: 'seating_publication', id: pub.data.publicationId } });
    const nav = expectOk(await run(showMyTableOnFloorplan, A1, {}));
    expect(nav.data).toEqual({ route: '/your-weekend', highlight: 'table-t1', floorPlanId: planId, anchorId: 't1', tableName: 'Draft Table Alpha' });
    const itinerary = expectOk(await run(getMyItinerary, A1, {}));
    expect(itinerary.data.seating.published).toBe(true);
    expect(itinerary.data.seating.table?.table.name).toBe('Draft Table Alpha');

    // A manager may read a household member; a member may not read the manager; nobody reads another household.
    expect(expectOk(await run(getMyTable, A1, { guestId: FX.guestA2 })).data.table.seatNumber).toBe(2);
    expect(expectErr(await run(getMyTable, A2, { guestId: FX.guestA1 })).code).toBe('forbidden');
    expect(expectErr(await run(getMyTable, A1, { guestId: FX.guestB1 })).code).toBe('forbidden');
    expect(expectErr(await run(getMyTable, B1, { guestId: FX.guestA1 })).code).toBe('forbidden');
    expect(expectErr(await run(getMyTable, { kind: 'anonymous' }, {})).code).toBe('unauthenticated');
    expect(expectErr(await run(getMyTable, fixturePrincipal('A1', { entitlements: new Set(['view_event']) }), {})).code).toBe('forbidden');
    // A seated guest never sees another table's contents.
    expect(JSON.stringify(expectOk(await run(getMyTable, B1, {})).data)).not.toContain('Ada');
    expect(expectErr(await run(getMyTable, fixturePrincipal('A1', { guestId: FX.guestA3, actsFor: [FX.guestA3] }), {})).code).toBe('not_found');
  });

  it('keeps later draft edits invisible until the next publish; unpublish hides everything again', async () => {
    expectOk(await run(adminAssignSeats, admin, { changes: [{ guestId: FX.guestA1, tableId: tableB, seatNumber: 5 }] }));
    const gamma = expectOk(await run(adminUpsertTable, admin, { name: 'Draft Table Delta', capacity: 6 })).data.id;
    expect(expectOk(await run(getMyTable, A1, {})).data.table).toMatchObject({ id: tableA, seatNumber: 1 });
    expect(await everyGuestResponse(A1)).not.toContain(gamma);
    expect(expectOk(await run(adminSeatingOverview, admin, {})).data.draftDiffers).toBe(true);

    expectOk(await run(adminPublishSeating, admin, {}));
    expect(expectOk(await run(getMyTable, A1, {})).data.table).toMatchObject({ id: tableB, seatNumber: 5, tablemates: ['Dev Fixture', 'Eve Fixture'] });

    expectOk(await run(adminUnpublishSeating, admin, {}, { requestId: 'req-unpub-1' }));
    expect((await listAuditEvents(db, { requestId: 'req-unpub-1', action: 'seating.unpublished' })).length).toBe(1);
    expect(expectErr(await run(getMyTable, A1, {})).code).toBe('not_found');
    expect(expectOk(await run(getMyItinerary, A1, {})).data.seating).toEqual({ published: false, table: null });
    expect(expectOk(await run(adminSeatingOverview, admin, {})).data.history.length).toBe(2);

    expectOk(await run(adminDeleteTable, admin, { id: gamma }));
    expect(expectErr(await run(adminDeleteTable, admin, { id: gamma })).code).toBe('not_found');
  });

  it('keeps every admin seating capability behind admin_guest_ops', async () => {
    const planner = fixtureAdmin({ entitlements: new Set(['admin_content']) });
    for (const [cap, input] of [
      [adminSeatingOverview, {}],
      [adminUpsertTable, { name: 'x', capacity: 2 }],
      [adminAssignSeats, { changes: [{ guestId: FX.guestA1, tableId: null }] }],
      [adminImportSeatingCsv, { csv: 'a,1,b' }],
      [adminPublishSeating, {}],
      [adminUnpublishSeating, {}],
    ] as const) {
      expect(expectErr(await run(cap as never, planner, input)).code).toBe('forbidden');
      expect(expectErr(await run(cap as never, A1, input)).code).toBe('forbidden');
      expect(expectErr(await run(cap as never, { kind: 'anonymous' }, input)).code).toBe('unauthenticated');
    }
  });
});
