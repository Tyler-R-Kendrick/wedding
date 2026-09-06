import { describe, expect, it } from 'vitest';
import { devInbox } from '@/providers/auth-email/mock';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { guests, households } from '@/db/schema';
import { upsertGuest } from '@/domain/guests/repo';
import { upsertHousehold } from '@/domain/households/repo';
import { listAuditEvents } from '@/lib/audit';
import { call, claim, expectErr, expectOk, principalFor, seed, signIn } from './harness';

describe('forwarded links and cross-guest attempts', () => {
  it('a forwarded link cannot take over a claimed guest: the code goes to the bound inbox only', async () => {
    const f = await seed('tk1');
    await claim(f.invitations.okafor.token, f.guests.chidi, f.emails.chidi);
    devInbox.clear();
    // Attacker holds the link and picks Chidi: nothing reaches the attacker, only Chidi's inbox.
    const req = expectOk(await call<{ sent: boolean; challenge: string; deliveredTo: string }>('request_otp', { purpose: 'claim', token: f.invitations.okafor.token, guestId: f.guests.chidi }));
    expect(req.data.sent).toBe(true);
    expect(devInbox.list().map((m) => m.to)).toEqual([f.emails.chidi]);
    expectErr(await call('verify_otp', { challenge: req.data.challenge, code: '123456' }), 'validation');
    // Chidi himself (owning the inbox) can still sign in through the same link.
    const second = await claim(f.invitations.okafor.token, f.guests.chidi, f.emails.chidi);
    const p = await principalFor({ cookie: second.cookie });
    expect(p.kind === 'guest' && p.guestId).toBe(f.guests.chidi);
  });

  it('typing another guest’s email at sign-in yields an identical response but no code and no binding', async () => {
    const f = await seed('tk2');
    devInbox.clear();
    const known = expectOk(await call<{ sent: boolean; challenge: string; deliveredTo: string }>('request_otp', { purpose: 'sign_in', email: f.emails.amara }));
    const unknown = expectOk(await call<{ sent: boolean; challenge: string; deliveredTo: string }>('request_otp', { purpose: 'sign_in', email: `nobody+${Math.random().toString(36).slice(2)}@example.test` }));
    expect(Object.keys(known.data).sort()).toEqual(Object.keys(unknown.data).sort());
    expect(unknown.data.sent).toBe(true);
    expect(devInbox.list().map((m) => m.to)).toEqual([f.emails.amara]);
    const fail = expectErr(await call('verify_otp', { challenge: unknown.data.challenge, code: '123456' }), 'validation');
    expect(fail.message).toMatch(/didn’t work/);
  });

  it('a signed-in guest cannot claim or read another household, and cannot claim a guest bound elsewhere', async () => {
    const f = await seed('tk3');
    const chidi = await claim(f.invitations.okafor.token, f.guests.chidi, f.emails.chidi);
    const ana = await claim(f.invitations.ruiz.token, f.guests.ana, f.emails.ana);
    // Ana tries to claim Chidi (different household, no link) -> forbidden.
    expectErr(await call('claim_identity', { guestId: f.guests.chidi }, { cookie: ana.cookie }), 'forbidden');
    // Ana with Chidi's link tries to claim Chidi: a link only ever unlocks a self-bind for one's own address -> forbidden, never taken over.
    expectErr(await call('claim_identity', { guestId: f.guests.chidi, token: f.invitations.okafor.token }, { cookie: ana.cookie }), 'forbidden');
    // Ana with Chidi's link tries Amara (has her own email) -> forbidden (Amara signs in herself).
    expectErr(await call('claim_identity', { guestId: f.guests.amara, token: f.invitations.okafor.token }, { cookie: ana.cookie }), 'forbidden');
    // Chidi still resolves to his own household; Ana's reads never include Chidi's household.
    const mine = expectOk(await call<{ household: { id: string } }>('get_my_invitation', {}, { cookie: ana.cookie }));
    expect(mine.data.household.id).toBe(f.households.ruiz);
    const his = expectOk(await call<{ household: { id: string } }>('get_my_invitation', {}, { cookie: chidi.cookie }));
    expect(his.data.household.id).toBe(f.households.okafor);
  });

  it('sign-in binds only guests whose email matches; guests bound to another inbox are skipped', async () => {
    const f = await seed('tk4');
    const first = await signIn(f.emails.amara);
    expect(first.outcome.guestId).toBe(f.guests.amara);
    const p = await principalFor({ cookie: first.cookie });
    expect(p.kind === 'guest' && p.actsFor).toEqual([f.guests.amara]);
    expect(p.kind === 'guest' && p.entitlements.has('manage_household_rsvp')).toBe(false);
  });

  it('B2: a guest from another household with only that household’s link cannot become manager of a no-email adult', async () => {
    const f = await seed('tk5');
    const amara = await signIn(f.emails.amara);
    const r = expectErr(await call('claim_identity', { guestId: f.guests.ruth, token: f.invitations.fitzgerald.token }, { cookie: amara.cookie }), 'forbidden');
    expect(r.message).toMatch(/different invitation/);
    const after = await principalFor({ cookie: amara.cookie });
    expect(after.kind === 'guest' && after.actsFor).toEqual([f.guests.amara]);
    expect(after.kind === 'guest' && after.entitlements.has('manage_household_rsvp')).toBe(false);
    const db = await getDb();
    expect((await db.select().from(guests).where(eq(guests.id, f.guests.ruth)))[0]!.managedByGuestId).toBeNull();
    const denied = await listAuditEvents(db, { action: 'identity.bound', targetType: 'guest', targetId: f.guests.ruth });
    expect(denied.some((e) => e.outcome === 'denied' && e.metadata?.reason === 'foreign_household')).toBe(true);
  });

  it('S1: a non-manager household member cannot re-point a no-email adult already managed by the manager', async () => {
    const db = await getDb();
    const hh = await upsertHousehold(db, { name: 'Household s1-tk6' });
    if (!hh.ok) throw hh.error;
    const M = await upsertGuest(db, { householdId: hh.value.id, firstName: 'Manager', lastName: 'One', email: 'manager+tk6@example.test' });
    const N = await upsertGuest(db, { householdId: hh.value.id, firstName: 'Nephew', lastName: 'Two', email: 'nephew+tk6@example.test' });
    if (!M.ok || !N.ok) throw new Error('seed');
    const R = await upsertGuest(db, { householdId: hh.value.id, firstName: 'Grandma', lastName: 'Three', managedByGuestId: M.value.id });
    if (!R.ok) throw R.error;
    await upsertHousehold(db, { id: hh.value.id, name: 'Household s1-tk6', managerGuestId: M.value.id });
    const n = await signIn('nephew+tk6@example.test');
    expectErr(await call('claim_identity', { guestId: R.value.id }, { cookie: n.cookie }), 'forbidden');
    expect((await db.select().from(guests).where(eq(guests.id, R.value.id)))[0]!.managedByGuestId).toBe(M.value.id);
    const after = await principalFor({ cookie: n.cookie });
    expect(after.kind === 'guest' && after.entitlements.has('manage_household_rsvp')).toBe(false);
    // The household manager may (re)confirm managing them; nothing changes for the nephew.
    const m = await signIn('manager+tk6@example.test');
    const ok1 = expectOk(await call<{ status: string }>('claim_identity', { guestId: R.value.id }, { cookie: m.cookie }));
    expect(ok1.data.status).toBe('managed');
    expect((await db.select({ id: households.id }).from(households).where(eq(households.id, hh.value.id))).length).toBe(1);
  });
});
