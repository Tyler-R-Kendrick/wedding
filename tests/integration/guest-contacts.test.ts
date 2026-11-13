import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { guestContacts } from '@/db/schema';
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
  it('C-01 C-02: secondary email and phone sign-in lookup', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `Sec ${Date.now()}` }));
    const g = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Secondary', lastName: 'Contact' }));
    await replaceGuestContacts(db, g.id, [
      { kind: 'email', value: 'primary-sec@example.test', isPrimary: true },
      { kind: 'email', value: 'secondary-sec@example.test', label: 'work' },
      { kind: 'phone', value: '+15550001112', isPrimary: true },
      { kind: 'phone', value: '+15550002223', label: 'cell' },
    ]);
    expect((await findGuestsByEmail(db, 'secondary-sec@example.test'))[0]?.id).toBe(g.id);
    expect((await findGuestsByPhone(db, '+15550002223'))[0]?.id).toBe(g.id);
  });

  it('C-04: backfill leaves contact rows for legacy columns', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `Backfill ${Date.now()}` }));
    const email = `backfill-${Date.now()}@example.test`;
    const g = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Back', lastName: 'Fill', email }));
    const rows = await db.select().from(guestContacts).where(eq(guestContacts.guestId, g.id));
    expect(rows.some((r) => r.kind === 'email' && r.value === email)).toBe(true);
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
