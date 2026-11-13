import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { guestContacts, guests } from '@/db/schema';
import { replaceGuestContacts, syncPrimaryContactColumn } from '@/domain/guests/contacts';
import { upsertHousehold } from '@/domain/households/repo';
import { findGuestsByEmail, upsertGuest } from '@/domain/guests/repo';
import { completeSocialSignIn, GUEST_SIGN_IN_FAIL_PATH } from '@/domain/identity/social/complete';
import { getAuditSink } from '@/lib/audit';
import { grantAdmin, seed } from '../identity/harness';
import type { CookieSink } from '@/lib/auth/cookies';

function requireRepoOk<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

describe('council extension rows', () => {
  it('C-12: migration backfill uses ON CONFLICT DO NOTHING for duplicate contacts', async () => {
    const sqlText = await import('node:fs').then((fs) =>
      fs.readFileSync('src/db/migrations/0025_guest_contacts.sql', 'utf8'),
    );
    expect(sqlText).toMatch(/ON CONFLICT \("kind", "value"\) DO NOTHING/);
  });

  it('C-13: replacing contacts with empty list clears guest primary email', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `C13 ${Date.now()}` }));
    const g = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Clear', lastName: 'Primary', email: 'clear@example.test' }));
    await replaceGuestContacts(db, g.id, []);
    const [row] = await db.select({ email: guests.email, phone: guests.phone }).from(guests).where(eq(guests.id, g.id));
    expect(row?.email).toBeNull();
    expect(row?.phone).toBeNull();
  });

  it('C-14: cross-guest phone conflict is rejected', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `C14 ${Date.now()}` }));
    const one = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'One', lastName: 'Phone', phone: '+15550100011' }));
    const two = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Two', lastName: 'Phone' }));
    const bad = await syncPrimaryContactColumn(db, two.id, 'phone', '+15550100011');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toMatch(/another guest already uses that phone/i);
    await db.delete(guestContacts).where(eq(guestContacts.guestId, one.id));
    await db.delete(guests).where(eq(guests.id, one.id));
    await db.delete(guests).where(eq(guests.id, two.id));
  });

  it('A-13: verified social email matching a child guest does not sign in', async () => {
    const f = await seed('a13-child');
    const db = await getDb();
    await grantAdmin(`a13-admin+${Date.now()}@example.test`, 'owner');
    const sink: CookieSink = { setCookies: [] };
    const audit = await getAuditSink();
    const childEmail = `child-soc+${Date.now()}@example.test`;
    await replaceGuestContacts(db, f.guests.nora, [{ kind: 'email', value: childEmail, isPrimary: true }]);
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: `g-child-${Date.now()}`, email: childEmail, emailVerified: true, givenName: 'Nora', familyName: 'Fitzgerald' },
      accessToken: 't',
      next: null,
      ipHash: 'ip',
      requestId: 'a13',
      audit,
    });
    expect(r.ok).toBe(false);
    expect(sink.setCookies.some((c) => c.includes('session_token'))).toBe(false);
  });

  it('A-14: verified email on merged guest does not sign in', async () => {
    const db = await getDb();
    const hh = requireRepoOk(await upsertHousehold(db, { name: `A14 ${Date.now()}` }));
    const keep = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Keep', lastName: 'Merge', email: 'keep-a14@example.test' }));
    const merged = requireRepoOk(await upsertGuest(db, { householdId: hh.id, firstName: 'Merged', lastName: 'Away', email: 'merged-a14@example.test' }));
    await db.update(guests).set({ mergedIntoGuestId: keep.id }).where(eq(guests.id, merged.id));
    expect((await findGuestsByEmail(db, 'merged-a14@example.test'))).toHaveLength(0);
    const sink: CookieSink = { setCookies: [] };
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: `g-merged-${Date.now()}`, email: 'merged-a14@example.test', emailVerified: true, givenName: 'Merged', familyName: 'Away' },
      accessToken: 't',
      next: null,
      ipHash: 'ip',
      requestId: 'a14',
      audit,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.redirectTo).toBe(GUEST_SIGN_IN_FAIL_PATH);
  });

  it('X-09: provider error shape still redirects to save-the-date without session', async () => {
    const db = await getDb();
    const sink: CookieSink = { setCookies: [] };
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: `g-x09-${Date.now()}`, givenName: '', familyName: '' },
      accessToken: 't',
      next: null,
      ipHash: 'ip',
      requestId: 'x09',
      audit,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.redirectTo).toBe(GUEST_SIGN_IN_FAIL_PATH);
    expect(sink.setCookies.filter((c) => c.includes('session_token'))).toHaveLength(0);
  });
});
