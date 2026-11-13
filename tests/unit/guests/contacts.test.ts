import { describe, expect, it } from 'vitest';
import { validateContactInput, replaceGuestContacts, syncPrimaryContactColumn } from '@/domain/guests/contacts';
import { findGuestsByEmail, upsertGuest, deleteGuest } from '@/domain/guests/repo';
import { upsertHousehold } from '@/domain/households/repo';
import { getDb } from '@/db/client';
import type { GuestContactInput } from '@/domain/guests/contacts';

function requireOk<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('guest contacts (C, E)', { timeout: 30_000 }, () => {
  it('C-08 E-01: normalizes email and rejects duplicate on one guest', async () => {
    const v = validateContactInput({ kind: 'email', value: '  Test.User+tag@EXAMPLE.com  ' });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.value).toBe('test.user+tag@example.com');
    const db = await getDb();
    const hh = requireOk(await upsertHousehold(db, { name: `Contacts ${Date.now()}` }));
    const g = requireOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Contact', lastName: 'Tester' }));
    const dup = await replaceGuestContacts(db, g.id, [
      { kind: 'email', value: 'a@example.test' },
      { kind: 'email', value: 'a@example.test' },
    ]);
    expect(dup.ok).toBe(false);
    await deleteGuest(db, g.id);
  });

  it('E-02 E-03: plus tags and gmail dots stay distinct values', async () => {
    const db = await getDb();
    const hh = requireOk(await upsertHousehold(db, { name: `Dots ${Date.now()}` }));
    const a = requireOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Dot', lastName: 'One', email: 'ab@test.example' }));
    const b = requireOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Dot', lastName: 'Two', email: 'a.b@test.example' }));
    const byPlus = await findGuestsByEmail(db, 'user+tag@plus.example');
    expect(byPlus).toHaveLength(0);
    await replaceGuestContacts(db, a.id, [{ kind: 'email', value: 'user+tag@plus.example', isPrimary: true }]);
    expect((await findGuestsByEmail(db, 'user+tag@plus.example')).map((x) => x.id)).toContain(a.id);
    expect((await findGuestsByEmail(db, 'user@plus.example')).length).toBe(0);
    await deleteGuest(db, b.id);
    await deleteGuest(db, a.id);
  });

  it('C-07: blocks stealing another guest contact', async () => {
    const db = await getDb();
    const hh = requireOk(await upsertHousehold(db, { name: `Steal ${Date.now()}` }));
    const one = requireOk(await upsertGuest(db, { householdId: hh.id, firstName: 'One', lastName: 'Guest', email: 'only-one@example.test' }));
    const two = requireOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Two', lastName: 'Guest' }));
    const bad = await syncPrimaryContactColumn(db, two.id, 'email', 'only-one@example.test');
    expect(bad.ok).toBe(false);
    await deleteGuest(db, two.id);
    await deleteGuest(db, one.id);
  });

  it('C-03: primary column syncs with contact', async () => {
    const db = await getDb();
    const hh = requireOk(await upsertHousehold(db, { name: `Primary ${Date.now()}` }));
    const g = requireOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Prim', lastName: 'Mary', email: 'primary@example.test' }));
    const rows: GuestContactInput[] = [
      { kind: 'email', value: 'secondary@example.test', label: 'work' },
      { kind: 'email', value: 'primary@example.test', isPrimary: true },
    ];
    const r = await replaceGuestContacts(db, g.id, rows);
    expect(r.ok).toBe(true);
    const found = await findGuestsByEmail(db, 'secondary@example.test');
    expect(found.some((x) => x.id === g.id)).toBe(true);
    await deleteGuest(db, g.id);
  });
});
