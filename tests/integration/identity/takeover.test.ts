import { describe, expect, it } from 'vitest';
import { devInbox } from '@/providers/auth-email/mock';
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
    // Ana with Chidi's link tries to claim Chidi (bound to Chidi's inbox) -> conflict, never taken over.
    expectErr(await call('claim_identity', { guestId: f.guests.chidi, token: f.invitations.okafor.token }, { cookie: ana.cookie }), 'conflict');
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
});
