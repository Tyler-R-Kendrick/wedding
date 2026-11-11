import { describe, expect, it } from 'vitest';
import { newId } from '@/contracts/ids';
import { adminUpsertGuest, adminUpsertHousehold } from '@/capabilities/admin_guest_ops';
import { adminDeleteGiftFund, adminDeleteGiftLink, adminUpsertGiftFund, adminUpsertGiftLink } from '@/capabilities/admin_gifts';
import { adminDeleteReservationVenue, adminUpsertReservationVenue } from '@/capabilities/admin_reservations';
import { adminListEvents } from '@/capabilities/events/admin_events';
import { adminSeatingOverview } from '@/capabilities/seating/admin_seating';
import { adminSaveHotel } from '@/capabilities/travel/admin_save_hotel';
import { adminRemoveHotel } from '@/capabilities/travel/admin_remove_hotel';
import { FX, fixtureAdmin } from '@/db/seed/fixtures';
import { expectOk, run, seedSwarmE } from './helpers/swarm-e';
import { call, grantAdmin, signIn, expectOk as expectOkHttp } from './identity/harness';

/**
 * CRUD smoke for admin capabilities grouped by console screen. Each test uses the real pipeline
 * and the per-file PGlite database (Swarm E fixtures for guest-domain screens).
 */
describe('admin capability CRUD (integration)', () => {
  const admin = fixtureAdmin();

  it('guest ops: household and guest upsert round-trip', async () => {
    await seedSwarmE();
    const hh = expectOk(await run(adminUpsertHousehold, admin, { name: `New household ${Date.now()}` }));
    const guest = expectOk(
      await run(adminUpsertGuest, admin, { householdId: hh.data.household.id, firstName: 'New', lastName: 'Person', email: `new+${Date.now()}@example.test` }),
    );
    expect(guest.data.guest.householdId).toBe(hh.data.household.id);
  });

  it('gifts: create and delete a fund and registry link', async () => {
    await seedSwarmE();
    const id = `test-fund-${Date.now()}`;
    expectOk(await run(adminUpsertGiftFund, admin, { id, title: 'Test fund', active: true, sortOrder: 99 }));
    expectOk(await run(adminDeleteGiftFund, admin, { id }));
    const linkId = `test-link-${Date.now()}`;
    expectOk(
      await run(adminUpsertGiftLink, admin, {
        id: linkId,
        kind: 'registry',
        label: 'Test registry',
        url: 'https://www.zola.com/registry/test-crud',
        active: true,
        sortOrder: 99,
      }),
    );
    expectOk(await run(adminDeleteGiftLink, admin, { id: linkId }));
  });

  it('reservations: create and delete a venue', async () => {
    await seedSwarmE();
    const id = `test-venue-${Date.now()}`;
    expectOk(
      await run(adminUpsertReservationVenue, admin, {
        id,
        name: 'Test reservation spot',
        resySlug: 'test-resy-spot',
        note: 'fixture',
      }),
    );
    expectOk(await run(adminDeleteReservationVenue, admin, { id }));
  });

  it('travel: save and remove a hotel handoff', async () => {
    await seedSwarmE();
    const id = newId();
    expectOk(
      await run(adminSaveHotel, admin, {
        id,
        name: 'Test hotel block',
        bookingUrl: 'https://www.chicagoathletichotel.com/',
        sortOrder: 99,
      }),
    );
    expectOk(await run(adminRemoveHotel, admin, { hotelId: id }));
  });

  it('rsvp admin reads succeed for fixture guests', async () => {
    await seedSwarmE();
    await grantAdmin('planner+crud@example.test', 'planner');
    const session = await signIn('planner+crud@example.test', {}, 'admin_sign_in');
    const overview = expectOkHttp(await call<{ rows: unknown[] }>('admin_rsvp_overview', {}, { cookie: session.cookie }));
    expect(Array.isArray(overview.data.rows)).toBe(true);
    const exportCsv = expectOkHttp(await call<{ csv: string }>('admin_export_rsvp', {}, { cookie: session.cookie }));
    expect(typeof exportCsv.data.csv).toBe('string');
  });

  it('seating admin overview loads for fixture data', async () => {
    await seedSwarmE();
    const overview = expectOk(await run(adminSeatingOverview, admin, {}));
    expect(Array.isArray(overview.data.tables)).toBe(true);
  });

  it('events admin lists fixture events', async () => {
    await seedSwarmE();
    const list = expectOk(await run(adminListEvents, admin, {}));
    expect(list.data.events.length).toBeGreaterThan(0);
    expect(list.data.guests.some((g) => g.guestId === FX.guestA1)).toBe(true);
  });

  it('ops admin reads: lifecycle, audit, jobs, flags, metrics, providers', async () => {
    await seedSwarmE();
    await grantAdmin('owner+ops@example.test', 'owner');
    const session = await signIn('owner+ops@example.test', {}, 'admin_sign_in');
    for (const name of ['admin_lifecycle_status', 'admin_search_audit', 'admin_jobs_overview', 'admin_flag_status', 'admin_ops_metrics', 'admin_provider_status'] as const) {
      const res = expectOkHttp(await call(name, {}, { cookie: session.cookie }));
      expect(res.data).toBeTruthy();
    }
  });
});
