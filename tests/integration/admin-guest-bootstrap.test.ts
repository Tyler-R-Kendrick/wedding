import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { guests, households } from '@/db/schema';
import { listGuests } from '@/domain/guests/repo';
import { listHouseholds } from '@/domain/households/repo';
import { call, expectOk, grantAdmin, signIn } from './identity/harness';

/**
 * Production seed has no guest rows. These flows must work on an empty guest domain.
 */
describe('admin guest bootstrap (empty guest tables)', () => {
  it('creates a household, then a guest, and lists both', async () => {
    const db = await getDb();
    await db.delete(guests);
    await db.delete(households);
    expect(await listHouseholds(db)).toHaveLength(0);
    expect(await listGuests(db, {})).toHaveLength(0);

    await grantAdmin('owner+bootstrap@example.test', 'owner');
    const admin = await signIn('owner+bootstrap@example.test', {}, 'admin_sign_in');

    const created = expectOk(
      await call<{ household: { id: string; name: string; managerGuestId: string | null } }>('admin_upsert_household', { name: 'The Bootstrap Family' }, { cookie: admin.cookie }),
    );
    expect(created.data.household.name).toBe('The Bootstrap Family');
    expect(created.data.household.managerGuestId).toBeNull();

    const guest = expectOk(
      await call<{ guest: { id: string; displayName: string; householdId: string } }>(
        'admin_upsert_guest',
        { householdId: created.data.household.id, firstName: 'Ada', lastName: 'Bootstrap', email: 'ada+bootstrap@example.test' },
        { cookie: admin.cookie },
      ),
    );
    expect(guest.data.guest.displayName).toBe('Ada Bootstrap');

    const listed = expectOk(await call<{ households: { id: string; name: string; memberCount: number }[] }>('admin_list_households', {}, { cookie: admin.cookie }));
    expect(listed.data.households).toHaveLength(1);
    expect(listed.data.households[0]).toMatchObject({ id: created.data.household.id, memberCount: 1 });

    const guestsListed = expectOk(await call<{ guests: { id: string }[] }>('admin_list_guests', {}, { cookie: admin.cookie }));
    expect(guestsListed.data.guests.map((g) => g.id)).toEqual([guest.data.guest.id]);
  });

  it('deletes an empty household after removing its only guest', async () => {
    const db = await getDb();
    await db.delete(guests);
    await db.delete(households);

    await grantAdmin('owner+bootstrap2@example.test', 'owner');
    const admin = await signIn('owner+bootstrap2@example.test', {}, 'admin_sign_in');
    const hh = expectOk(await call<{ household: { id: string } }>('admin_upsert_household', { name: 'Temporary household' }, { cookie: admin.cookie }));
    const g = expectOk(
      await call<{ guest: { id: string } }>('admin_upsert_guest', { householdId: hh.data.household.id, firstName: 'Temp', lastName: 'Guest' }, { cookie: admin.cookie }),
    );
    expectOk(await call('admin_delete_guest', { guestId: g.data.guest.id }, { cookie: admin.cookie }));
    expectOk(await call('admin_delete_household', { householdId: hh.data.household.id }, { cookie: admin.cookie }));
    expect(await listHouseholds(db)).toHaveLength(0);
  });

  it('CSV import creates households and guests on an empty database', async () => {
    const db = await getDb();
    await db.delete(guests);
    await db.delete(households);

    await grantAdmin('owner+bootstrap3@example.test', 'owner');
    const admin = await signIn('owner+bootstrap3@example.test', {}, 'admin_sign_in');
    const csv = `household,first_name,last_name,email,kind,manager,event_keys\nImported Family,Pat,Import,pat+import@example.test,adult,yes,ceremony\n`;
    const imported = expectOk(await call<{ householdsCreated: number; guestsCreated: number }>('admin_import_guests_csv', { csv }, { cookie: admin.cookie }));
    expect(imported.data).toMatchObject({ householdsCreated: 1, guestsCreated: 1 });
    const [row] = await db.select().from(households).where(eq(households.name, 'Imported Family'));
    expect(row?.managerGuestId).toBeTruthy();
  });
});
