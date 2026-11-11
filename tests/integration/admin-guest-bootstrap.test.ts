import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { households } from '@/db/schema';
import { call, expectOk, grantAdmin, signIn } from './identity/harness';

/** Admin guest/household bootstrap capabilities (works whether or not seed fixtures exist). */
describe('admin guest bootstrap', () => {
  it('creates a household, then a guest, and lists both', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await grantAdmin(`owner+bootstrap-${suffix}@example.test`, 'owner');
    const admin = await signIn(`owner+bootstrap-${suffix}@example.test`, {}, 'admin_sign_in');

    const created = expectOk(
      await call<{ household: { id: string; name: string; managerGuestId: string | null } }>(
        'admin_upsert_household',
        { name: `The Bootstrap Family ${suffix}` },
        { cookie: admin.cookie },
      ),
    );
    expect(created.data.household.name).toBe(`The Bootstrap Family ${suffix}`);
    expect(created.data.household.managerGuestId).toBeNull();

    const guest = expectOk(
      await call<{ guest: { id: string; displayName: string; householdId: string } }>(
        'admin_upsert_guest',
        { householdId: created.data.household.id, firstName: 'Ada', lastName: 'Bootstrap', email: `ada+bootstrap-${suffix}@example.test` },
        { cookie: admin.cookie },
      ),
    );
    expect(guest.data.guest.displayName).toBe('Ada Bootstrap');

    const listed = expectOk(await call<{ households: { id: string; name: string; memberCount: number }[] }>('admin_list_households', {}, { cookie: admin.cookie }));
    expect(listed.data.households.find((h) => h.id === created.data.household.id)).toMatchObject({ memberCount: 1 });

    const guestsListed = expectOk(
      await call<{ guests: { id: string }[] }>('admin_list_guests', { householdId: created.data.household.id }, { cookie: admin.cookie }),
    );
    expect(guestsListed.data.guests.map((g) => g.id)).toEqual([guest.data.guest.id]);
  });

  it('deletes an empty household after removing its only guest', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await grantAdmin(`owner+bootstrap2-${suffix}@example.test`, 'owner');
    const admin = await signIn(`owner+bootstrap2-${suffix}@example.test`, {}, 'admin_sign_in');
    const hh = expectOk(await call<{ household: { id: string } }>('admin_upsert_household', { name: `Temporary household ${suffix}` }, { cookie: admin.cookie }));
    const g = expectOk(
      await call<{ guest: { id: string } }>('admin_upsert_guest', { householdId: hh.data.household.id, firstName: 'Temp', lastName: 'Guest' }, { cookie: admin.cookie }),
    );
    expectOk(await call('admin_delete_guest', { guestId: g.data.guest.id }, { cookie: admin.cookie }));
    expectOk(await call('admin_delete_household', { householdId: hh.data.household.id }, { cookie: admin.cookie }));
    const listed = expectOk(await call<{ households: { id: string }[] }>('admin_list_households', {}, { cookie: admin.cookie }));
    expect(listed.data.households.some((h) => h.id === hh.data.household.id)).toBe(false);
  });

  it('CSV import creates households and guests', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const db = await getDb();
    await grantAdmin(`owner+bootstrap3-${suffix}@example.test`, 'owner');
    const admin = await signIn(`owner+bootstrap3-${suffix}@example.test`, {}, 'admin_sign_in');
    const family = `Imported Family ${suffix}`;
    const csv = `household,first_name,last_name,email,kind,manager,event_keys\n${family},Pat,Import,pat+import-${suffix}@example.test,adult,yes,ceremony\n`;
    const imported = expectOk(await call<{ householdsCreated: number; guestsCreated: number }>('admin_import_guests_csv', { csv }, { cookie: admin.cookie }));
    expect(imported.data).toMatchObject({ householdsCreated: 1, guestsCreated: 1 });
    const [row] = await db.select().from(households).where(eq(households.name, family));
    expect(row?.managerGuestId).toBeTruthy();
  });
});
