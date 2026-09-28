import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { auditEvents } from '@/db/schema';
import { rebindIdentity } from '@/domain/identity/bindings';
import { GUEST_VIEW_COOKIE } from '@/domain/identity/guest-view';
import { getAuditSink } from '@/lib/audit';
import { call, claim, expectErr, expectOk, grantAdmin, principalFor, seed, signIn } from './harness';

/**
 * "Browse as a guest" (domain/identity/guest-view.ts): an administrator sees the site as one guest
 * does, and changes nothing in their name unless the guest is the administrator's own record.
 */
type Minted = { guestId: string; displayName: string; readOnly: boolean; token: string };
const withView = (cookie: string, token: string) => `${cookie}; ${GUEST_VIEW_COOKIE}=${encodeURIComponent(token)}`;

describe('browse as a guest', () => {
  it('an owner browses as another household read-only: that guest\'s reads, none of their writes', async () => {
    const f = await seed('gv1');
    const owner = await signIn(f.emails.admin, {}, 'admin_sign_in');
    expect((await principalFor({ cookie: owner.cookie })).kind).toBe('admin');

    const minted = expectOk(await call<Minted>('admin_browse_as_guest', { guestId: f.guests.ana }, { cookie: owner.cookie }));
    expect(minted.data).toMatchObject({ guestId: f.guests.ana, readOnly: true });
    const cookie = withView(owner.cookie, minted.data.token);

    // The console names whose view it is from the token (on an admin surface, as the console asks).
    type Status = { view: { guestId: string; displayName: string; readOnly: boolean } | null };
    const status = expectOk(await call<Status>('admin_guest_view_status', { token: minted.data.token }, { cookie: owner.cookie, method: 'GET' }));
    expect(status.data.view).toMatchObject({ guestId: f.guests.ana, displayName: minted.data.displayName, readOnly: true });
    const tampered = expectOk(await call<Status>('admin_guest_view_status', { token: `${minted.data.token}x` }, { cookie: owner.cookie, method: 'GET' }));
    expect(tampered.data.view).toBeNull();
    const again = await signIn(f.emails.admin, {}, 'admin_sign_in');
    const otherSession = expectOk(await call<Status>('admin_guest_view_status', { token: minted.data.token }, { cookie: again.cookie, method: 'GET' }));
    expect(otherSession.data.view).toBeNull();

    const p = await principalFor({ cookie, pathname: '/your-weekend' });
    expect(p.kind).toBe('guest');
    if (p.kind !== 'guest') throw new Error('unreachable');
    expect(p.guestId).toBe(f.guests.ana);
    expect(p.viewedBy?.readOnly).toBe(true);

    // What Ana would read, she reads; nothing can be done in her name.
    expectOk(await call('get_my_invitation', {}, { cookie }));
    // Not even the concierge, which reads but keeps a session and the questions in the asker's name.
    const asked = await call('ask_concierge', { question: 'When is the ceremony?' }, { cookie });
    if (!asked.ok) expect(asked.error.code === 'forbidden' || asked.error.code === 'feature_disabled').toBe(true);
    else throw new Error('the concierge answered in a read-only view');
    const refused = await call('update_my_contact', { email: 'someone-else@example.test' }, { cookie });
    expectErr(refused, 'forbidden');
    if (!refused.ok) expect(refused.error.message).toMatch(/browsing as this guest/);

    // The console is never viewed as a guest: it, its capabilities and its step-up keep the administrator.
    expect((await principalFor({ cookie, pathname: '/admin/guests' })).kind).toBe('admin');
    expect((await principalFor({ cookie, pathname: '/admin' })).kind).toBe('admin');
    expect((await principalFor({ cookie, pathname: '/step-up' })).kind).toBe('admin');
    // An /api request's real path wins over an `x-pathname` it sent itself.
    const { getPrincipal } = await import('@/lib/principal');
    const forged = new Headers({ host: 'localhost:3000', origin: 'http://localhost:3000', cookie, 'x-pathname': '/admin' });
    expect((await getPrincipal(new Request('http://localhost:3000/api/capabilities/get_my_rsvp', { method: 'POST', headers: forged }))).kind).toBe('guest');

    // Audited, next to the guest's own sign-ins.
    const db = await getDb();
    const rows = await db.select().from(auditEvents).where(and(eq(auditEvents.action, 'guest_view.started'), eq(auditEvents.targetId, f.guests.ana)));
    expect(rows).toHaveLength(1);
    // …and every row written during the view names the administrator, not only the guest.
    const invoked = await db.select().from(auditEvents).where(and(eq(auditEvents.action, 'capability.invoked'), eq(auditEvents.targetId, 'get_my_invitation')));
    const mine = invoked.filter((r) => (r.actor as { guestId?: string }).guestId === f.guests.ana);
    expect(mine.some((r) => (r.actor as { viewedBy?: { readOnly: boolean } }).viewedBy?.readOnly === true)).toBe(true);
  });

  it('the token belongs to one session: another session, a forged token, or a guest carrying it gets nothing', async () => {
    const f = await seed('gv2');
    const owner = await signIn(f.emails.admin, {}, 'admin_sign_in');
    const { token } = expectOk(await call<Minted>('admin_browse_as_guest', { guestId: f.guests.chidi }, { cookie: owner.cookie })).data;

    // The same administrator's other session (another browser) is not browsing as anyone.
    const again = await signIn(f.emails.admin, {}, 'admin_sign_in');
    expect((await principalFor({ cookie: withView(again.cookie, token) })).kind).toBe('admin');

    // A tampered token is ignored.
    const [id, exp] = token.split('.');
    expect((await principalFor({ cookie: withView(owner.cookie, `${id}.${exp}.forged`) })).kind).toBe('admin');
    expect((await principalFor({ cookie: withView(owner.cookie, `${f.guests.ana}.${exp}.${token.split('.')[2]}`) })).kind).toBe('admin');

    // A guest who somehow holds the cookie is still themselves: the view only ever applies to an admin.
    const ana = await claim(f.invitations.ruiz.token, f.guests.ana, f.emails.ana);
    const asAna = await principalFor({ cookie: withView(ana.cookie, token) });
    expect(asAna.kind === 'guest' && asAna.guestId).toBe(f.guests.ana);
    expect(asAna.kind === 'guest' && asAna.viewedBy).toBeFalsy();
  });

  it('only an owner browses as someone else: not a moderator, not a planner, and never as a child', async () => {
    const f = await seed('gv3');
    for (const role of ['moderator', 'planner'] as const) {
      const email = `${role}+gv3@example.test`;
      await grantAdmin(email, role);
      const admin = await signIn(email, {}, 'admin_sign_in');
      expectErr(await call('admin_browse_as_guest', { guestId: f.guests.ana }, { cookie: admin.cookie }), 'forbidden');
    }
    const owner = await signIn(f.emails.admin, {}, 'admin_sign_in');
    expectErr(await call('admin_browse_as_guest', { guestId: f.guests.nora }, { cookie: owner.cookie }), 'forbidden');
  });

  it('a binding an administrator made is not their own record: rebinding a guest to your inbox buys no write access', async () => {
    const f = await seed('gv6');
    const email = 'planner+gv6@example.test';
    await grantAdmin(email, 'planner');
    const planner = await signIn(email, {}, 'admin_sign_in');
    const db = await getDb();
    const bound = await rebindIdentity(db, { guestId: f.guests.chidi, email, reason: 'test', actor: { kind: 'system', component: 'test' }, requestId: 'gv6', audit: await getAuditSink() });
    expect(bound.ok).toBe(true);
    // A planner may not view anyone else, and this binding does not make Chidi "theirs".
    expectErr(await call('admin_browse_as_guest', { guestId: f.guests.chidi }, { cookie: planner.cookie }), 'forbidden');
    const own = expectOk(await call<{ records: unknown[] }>('admin_list_own_guest_records', {}, { cookie: planner.cookie, method: 'GET' }));
    expect(own.data.records).toEqual([]);
  });

  it('an administrator who is also invited browses as themself, and that view is their own session: not read-only', async () => {
    const f = await seed('gv4');
    await grantAdmin(f.emails.ana, 'moderator');
    const ana = await claim(f.invitations.ruiz.token, f.guests.ana, f.emails.ana);
    // Signed in, an admin is an admin (ADR-0001), even with a guest record…
    expect((await principalFor({ cookie: ana.cookie })).kind).toBe('admin');
    // …until they choose to browse as that record, which needs no guest-operations access.
    // Their own records are listed for them — the door for an administrator who is not an owner.
    const records = expectOk(await call<{ records: { guestId: string }[] }>('admin_list_own_guest_records', {}, { cookie: ana.cookie, method: 'GET' }));
    expect(records.data.records.map((r) => r.guestId)).toEqual([f.guests.ana]);
    const minted = expectOk(await call<Minted>('admin_browse_as_guest', { guestId: f.guests.ana }, { cookie: ana.cookie }));
    expect(minted.data.readOnly).toBe(false);
    const p = await principalFor({ cookie: withView(ana.cookie, minted.data.token) });
    expect(p.kind === 'guest' && p.viewedBy?.readOnly).toBe(false);
    expect(p.kind === 'guest' && p.guestId).toBe(f.guests.ana);
    // Their own record: a change is theirs to make, so authorize lets it through to the handler.
    const own = await call('update_my_contact', { email: 'ana-new@example.test' }, { cookie: withView(ana.cookie, minted.data.token) });
    if (!own.ok) expect(own.error.message).not.toMatch(/browsing as this guest/);
  });

  it('refuses a guest who does not exist', async () => {
    const f = await seed('gv5');
    const owner = await signIn(f.emails.admin, {}, 'admin_sign_in');
    expectErr(await call('admin_browse_as_guest', { guestId: 'NO_SUCH_GUEST_0000000000000' }, { cookie: owner.cookie }), 'not_found');
  });
});
