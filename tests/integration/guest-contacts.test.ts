import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { guestContacts, guests } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { upsertHousehold } from '@/domain/households/repo';
import { replaceGuestContacts } from '@/domain/guests/contacts';
import { findGuestsByEmail, findGuestsByPhone, upsertGuest } from '@/domain/guests/repo';
import { call, expectOk, grantAdmin, seed, signIn } from './identity/harness';

function requireRepoOk<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('guest contacts integration', () => {
  it('C-01: secondary email on guest_contacts resolves for sign-in lookup', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `SecE ${Date.now()}` }));
    const g = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Sec', lastName: 'Email' }));
    await replaceGuestContacts(db, g.id, [
      { kind: 'email', value: 'primary-e@example.test', isPrimary: true },
      { kind: 'email', value: 'secondary-e@example.test', label: 'work' },
    ]);
    expect((await findGuestsByEmail(db, 'secondary-e@example.test'))[0]?.id).toBe(g.id);
  });

  it('C-02: secondary phone on guest_contacts resolves for SMS lookup', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `SecP ${Date.now()}` }));
    const g = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Secondary', lastName: 'Phone' }));
    await replaceGuestContacts(db, g.id, [
      { kind: 'phone', value: '+15550001112', isPrimary: true },
      { kind: 'phone', value: '+15550002223', label: 'cell' },
    ]);
    expect((await findGuestsByPhone(db, '+15550002223'))[0]?.id).toBe(g.id);
  });

  it('C-09: move contact to another guest removes it from the donor', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `Move ${Date.now()}` }));
    const a = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Donor', lastName: 'Guest', email: 'donor@example.test' }));
    const b = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Target', lastName: 'Guest' }));
    const shared = 'moved@example.test';
    await replaceGuestContacts(db, a.id, [{ kind: 'email', value: shared, isPrimary: true }]);
    const steal = await replaceGuestContacts(db, b.id, [{ kind: 'email', value: shared, isPrimary: true }]);
    expect(steal.ok).toBe(false);
    await replaceGuestContacts(db, a.id, [{ kind: 'email', value: 'donor@example.test', isPrimary: true }]);
    await replaceGuestContacts(db, b.id, [{ kind: 'email', value: shared, isPrimary: true }]);
    expect((await findGuestsByEmail(db, shared)).map((x) => x.id)).toEqual([b.id]);
    expect((await findGuestsByEmail(db, shared)).some((x) => x.id === a.id)).toBe(false);
  });

  it('C-10: removing primary contact leaves secondary lookup for next sign-in', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `PrimRem ${Date.now()}` }));
    const g = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Prim', lastName: 'Removed' }));
    const secondary = `still-here+${Date.now()}@example.test`;
    await replaceGuestContacts(db, g.id, [
      { kind: 'email', value: `gone+${Date.now()}@example.test`, isPrimary: true },
      { kind: 'email', value: secondary },
    ]);
    await replaceGuestContacts(db, g.id, [{ kind: 'email', value: secondary, isPrimary: true }]);
    expect((await findGuestsByEmail(db, secondary))[0]?.id).toBe(g.id);
  });

  it('C-04: backfill leaves contact rows for legacy columns', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `Backfill ${Date.now()}` }));
    const email = `backfill-${Date.now()}@example.test`;
    const g = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Back', lastName: 'Fill', email }));
    const rows = await db.select().from(guestContacts).where(eq(guestContacts.guestId, g.id));
    expect(rows.some((r) => r.kind === 'email' && r.value === email)).toBe(true);
  });

  it('O-13: merged guest email is excluded from sign-in lookup', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `MergeO13 ${Date.now()}` }));
    const keep = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Keep', lastName: 'Lookup', email: 'keep-o13@example.test' }));
    const merged = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Drop', lastName: 'Lookup', email: 'drop-o13@example.test' }));
    await db.update(guests).set({ mergedIntoGuestId: keep.id, email: null }).where(eq(guests.id, merged.id));
    expect((await findGuestsByEmail(db, 'drop-o13@example.test'))).toHaveLength(0);
  });

  it('O-07: OTP challenge scoped to typed email not another contact', async () => {
    const f = await seed('contact-otp');
    const adminEmail = `contact-otp-admin+${Date.now()}@example.test`;
    await grantAdmin(adminEmail, 'owner');
    const admin = await signIn(adminEmail, {}, 'admin_sign_in');
    const db = await getDb();
    const sec = `ana-secondary+${Date.now()}@example.test`;
    await replaceGuestContacts(db, f.guests.ana, [
      { kind: 'email', value: 'ana-primary@example.test', isPrimary: true },
      { kind: 'email', value: sec },
    ]);
    const sent = expectOk(
      await call<{ sent: true; challenge: string }>('request_otp', { purpose: 'sign_in', email: sec }, { cookie: admin.cookie }),
    );
    const wrong = await call('verify_otp', { challenge: sent.data.challenge, code: '000000' }, { cookie: admin.cookie });
    expect(wrong.ok).toBe(false);
  });
});
