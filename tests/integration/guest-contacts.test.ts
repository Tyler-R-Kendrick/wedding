import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { guestContacts, guests } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { upsertHousehold } from '@/domain/households/repo';
import { replaceGuestContacts } from '@/domain/guests/contacts';
import { findGuestsByEmail, findGuestsByPhone, upsertGuest } from '@/domain/guests/repo';
import { devInbox } from '@/providers/auth-email/mock';
import { MockTwilioVerify } from '@/providers/twilio-verify/mock';
import { call, expectOk, latestCode, seed } from './identity/harness';

function requireRepoOk<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('guest contacts integration', () => {
  it('O-15 C-01: secondary email resolves and receives OTP at the typed address', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `SecE ${Date.now()}` }));
    const g = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Sec', lastName: 'Email' }));
    const secondary = `secondary-e+${Date.now()}@example.test`;
    await replaceGuestContacts(db, g.id, [
      { kind: 'email', value: `primary-e+${Date.now()}@example.test`, isPrimary: true },
      { kind: 'email', value: secondary, label: 'work' },
    ]);
    expect((await findGuestsByEmail(db, secondary))[0]?.id).toBe(g.id);
    devInbox.clear();
    const sent = expectOk(await call<{ sent: boolean; challenge: string; deliveredTo?: string }>('request_otp', { purpose: 'sign_in', email: secondary }));
    expect(sent.data.sent).toBe(true);
    expect(sent.data.deliveredTo).toMatch(/•/);
    const mail = devInbox.latestFor(secondary);
    expect(mail?.to?.toLowerCase()).toBe(secondary.toLowerCase());
    const code = await latestCode(secondary);
    const ver = expectOk(await call<{ guestId: string | null }>('verify_otp', { challenge: sent.data.challenge, code }));
    expect(ver.data.guestId).toBe(g.id);
  });

  it('T-05 C-02: secondary phone resolves and accepts phone OTP', async () => {
    const db = await getDb();
    const secondary = '+15550100022';
    MockTwilioVerify.clearPending();
    MockTwilioVerify.stage(secondary);
    const hh = requireRepoOk(await upsertHousehold(db, { name: `SecP ${Date.now()}` }));
    const g = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Secondary', lastName: 'Phone' }));
    await replaceGuestContacts(db, g.id, [
      { kind: 'phone', value: '+15550100011', isPrimary: true },
      { kind: 'phone', value: secondary, label: 'cell' },
    ]);
    expect((await findGuestsByPhone(db, secondary))[0]?.id).toBe(g.id);
    const sent = expectOk(await call<{ challenge: string }>('request_phone_otp', { phone: secondary }));
    const ver = expectOk(await call<{ guestId: string | null }>('verify_phone_otp', { challenge: sent.data.challenge, code: '000000' }));
    expect(ver.data.guestId).toBe(g.id);
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

  it('O-07: OTP code for contact A is invalid on contact B challenge', async () => {
    const f = await seed('contact-otp');
    const db = await getDb();
    const primary = f.emails.ana;
    const sec = `ana-secondary+${Date.now()}@example.test`;
    await replaceGuestContacts(db, f.guests.ana, [
      { kind: 'email', value: primary, isPrimary: true },
      { kind: 'email', value: sec },
    ]);
    devInbox.clear();
    const secSend = expectOk(await call<{ sent: boolean; challenge: string }>('request_otp', { purpose: 'sign_in', email: sec }));
    const secCode = await latestCode(sec);
    const priSend = expectOk(await call<{ sent: boolean; challenge: string }>('request_otp', { purpose: 'sign_in', email: primary }));
    await latestCode(primary);
    const cross = await call('verify_otp', { challenge: priSend.data.challenge, code: secCode });
    expect(cross.ok).toBe(false);
    const onSec = expectOk(await call<{ guestId: string | null }>('verify_otp', { challenge: secSend.data.challenge, code: secCode }));
    expect(onSec.data.guestId).toBe(f.guests.ana);
  });
});
