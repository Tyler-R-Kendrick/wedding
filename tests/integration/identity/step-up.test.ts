import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { authPasskeys } from '@/db/schema';
import { listAuditEvents } from '@/lib/audit';
import { ageSession, call, claim, cookieFrom, expectErr, expectOk, grantAdmin, latestCode, principalFor, seed, signIn } from './harness';

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

  it('register_passkey({step:\'remove\'}) audits passkey.removed; a foreign id is not_found and unaudited', async () => {
    const f = await seed('su3');
    const ana = await claim(f.invitations.ruiz.token, f.guests.ana, f.emails.ana);
    const db = await getDb();
    const p = await principalFor({ cookie: ana.cookie });
    if (p.kind !== 'guest') throw new Error('guest expected');
    await db.insert(authPasskeys).values({ id: 'pk-su3', name: 'Phone', publicKey: 'AQ', userId: p.authIdentityId, credentialID: 'cred-su3', counter: 0, deviceType: 'singleDevice', backedUp: false, createdAt: new Date() });
    const listed = expectOk(await call<{ status: string; passkeys: { id: string }[] }>('register_passkey', { step: 'list' }, { cookie: ana.cookie }));
    expect(listed.data.passkeys.map((k) => k.id)).toEqual(['pk-su3']);
    expectErr(await call('register_passkey', { step: 'remove', id: 'someone-elses' }, { cookie: ana.cookie }), 'not_found');
    const removed = expectOk(await call<{ status: string; id: string }>('register_passkey', { step: 'remove', id: 'pk-su3' }, { cookie: ana.cookie }));
    expect(removed.data).toEqual({ status: 'removed', id: 'pk-su3' });
    const audit = await listAuditEvents(db, { action: 'passkey.removed' });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ passkeyId: 'pk-su3' });
  });

  it('N3: editing a guest without a field keeps the stored value', async () => {
    const f = await seed('su4');
    await grantAdmin(`owner+su4@example.test`, 'owner');
    const admin = await signIn(`owner+su4@example.test`, {}, 'admin_sign_in');
    const before = expectOk(await call<{ guest: { isMinor: boolean; email: string | null } }>('admin_upsert_guest', { id: f.guests.ruth, householdId: f.households.fitzgerald, firstName: 'Ruth', lastName: 'Fitzgerald', isMinor: true, email: 'ruth+su4@example.test' }, { cookie: admin.cookie }));
    expect(before.data.guest).toMatchObject({ isMinor: true, email: 'ruth+su4@example.test' });
    const after = expectOk(await call<{ guest: { isMinor: boolean; email: string | null; lastName: string } }>('admin_upsert_guest', { id: f.guests.ruth, householdId: f.households.fitzgerald, firstName: 'Ruthie' }, { cookie: admin.cookie }));
    expect(after.data.guest).toMatchObject({ isMinor: true, email: 'ruth+su4@example.test', lastName: 'Fitzgerald' });
    const cleared = expectOk(await call<{ guest: { isMinor: boolean; email: string | null } }>('admin_upsert_guest', { id: f.guests.ruth, householdId: f.households.fitzgerald, firstName: 'Ruthie', isMinor: false, email: null }, { cookie: admin.cookie }));
    expect(cleared.data.guest).toMatchObject({ isMinor: false, email: null });
  });
});
