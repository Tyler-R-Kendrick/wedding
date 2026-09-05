import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { listAuditEvents } from '@/lib/audit';
import { ageSession, call, claim, cookieFrom, expectErr, expectOk, latestCode, principalFor, seed } from './harness';

describe('step-up', () => {
  it('a stale session is refused for identity actions until a fresh code rotates it', async () => {
    const f = await seed('su1');
    const ana = await claim(f.invitations.ruiz.token, f.guests.ana, f.emails.ana);
    await ageSession(ana.cookie, 6);
    const stale = await principalFor({ cookie: ana.cookie });
    expect(stale.kind).toBe('guest');
    expectErr(await call('claim_identity', { guestId: f.guests.anaPlusOne }, { cookie: ana.cookie }), 'step_up_required');
    expectErr(await call('update_my_contact', { email: 'ana2+su1@example.test' }, { cookie: ana.cookie }), 'step_up_required');
    expectErr(await call('register_passkey', { step: 'list' }, { cookie: ana.cookie }), 'step_up_required');

    const req = expectOk(await call<{ sent: boolean; challenge: string }>('request_otp', { purpose: 'step_up' }, { cookie: ana.cookie }));
    expect(req.data.sent).toBe(true);
    const up = await call<{ status: string; authenticatedAt: string }>('step_up', { method: 'otp', challenge: req.data.challenge, code: await latestCode(f.emails.ana) }, { cookie: ana.cookie });
    const fresh = expectOk(up);
    expect(fresh.data.status).toBe('fresh');
    const rotated = cookieFrom(up.sink);
    expect(rotated).not.toBe(ana.cookie); // session rotation
    expect((await principalFor({ cookie: ana.cookie })).kind).toBe('anonymous'); // old session ended
    const p = await principalFor({ cookie: rotated });
    expect(p.kind === 'guest' && p.guestId).toBe(f.guests.ana);
    expect(Date.now() - Date.parse(fresh.data.authenticatedAt)).toBeLessThan(10_000);
    const db = await getDb();
    expect((await listAuditEvents(db, { action: 'session.step_up' })).length).toBeGreaterThan(0);
    // A step-up challenge cannot be used by verify_otp, and a step-up code for someone else is refused.
    expectErr(await call('verify_otp', { challenge: req.data.challenge, code: '123456' }, { cookie: rotated }), 'validation');
    const list = expectOk(await call<{ status: string; passkeys: unknown[] }>('register_passkey', { step: 'list' }, { cookie: rotated }));
    expect(list.data).toEqual({ status: 'list', passkeys: [] });
  });

  it('email change sends a code to the new address and moves the identity and guest rows', async () => {
    const f = await seed('su2');
    const chidi = await claim(f.invitations.okafor.token, f.guests.chidi, f.emails.chidi);
    const newEmail = 'chidi.moved+su2@example.test';
    const first = expectOk(await call<{ status: string; challenge: string; deliveredTo: string }>('update_my_contact', { email: newEmail }, { cookie: chidi.cookie }));
    expect(first.data.status).toBe('verification_sent');
    expect(first.data.deliveredTo).toBe('c•••@e•••.test');
    expectErr(await call('update_my_contact', { email: newEmail, challenge: first.data.challenge, code: '000000' }, { cookie: chidi.cookie }), 'validation');
    const done = expectOk(await call<{ status: string }>('update_my_contact', { email: newEmail, challenge: first.data.challenge, code: await latestCode(newEmail) }, { cookie: chidi.cookie }));
    expect(done.data.status).toBe('updated');
    const req = expectOk(await call<{ sent: boolean; challenge: string }>('request_otp', { purpose: 'sign_in', email: newEmail }));
    const back = await call<{ guestId: string | null }>('verify_otp', { challenge: req.data.challenge, code: await latestCode(newEmail) });
    expect(expectOk(back).data.guestId).toBe(f.guests.chidi);
  });
});
