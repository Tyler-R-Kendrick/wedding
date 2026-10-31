import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { auditEvents } from '@/db/schema';
import { GUEST_VIEW_COOKIE } from '@/domain/identity/guest-view';
import { VIEW_ROLE_COOKIE } from '@/domain/identity/view-role';
import { seedPreviewPersonas } from '@/domain/identity/preview-personas';
import { call, claim, expectErr, expectOk, grantAdmin, principalFor, seed, signIn } from './harness';

type Minted = { role: string; label: string; readOnly: boolean; token: string };
const withRole = (cookie: string, token: string) => `${cookie}; ${VIEW_ROLE_COOKIE}=${encodeURIComponent(token)}`;

describe('admin view-role preview', () => {
  it('an owner previews as an invited guest: guest nav, read-only mutations refused', async () => {
    const f = await seed('vr1');
    const db = await getDb();
    await seedPreviewPersonas(db);
    const owner = await signIn(f.emails.admin, {}, 'admin_sign_in');
    expect((await principalFor({ cookie: owner.cookie })).kind).toBe('admin');

    const minted = expectOk(await call<Minted>('admin_set_view_role', { role: 'guest' }, { cookie: owner.cookie }));
    expect(minted.data.readOnly).toBe(true);
    const cookie = withRole(owner.cookie, minted.data.token);

    const p = await principalFor({ cookie, pathname: '/your-weekend' });
    expect(p.kind).toBe('guest');
    if (p.kind !== 'guest') throw new Error('unreachable');
    expect(p.viewedBy?.previewRole).toBe('guest');
    expect(p.viewedBy?.readOnly).toBe(true);

    expectOk(await call('get_my_invitation', {}, { cookie }));
    const refused = await call('update_my_contact', { email: 'nope@example.test' }, { cookie });
    expectErr(refused, 'forbidden');

    expect((await principalFor({ cookie, pathname: '/admin' })).kind).toBe('admin');

    const rows = await db.select().from(auditEvents).where(and(eq(auditEvents.action, 'view_role.started'), eq(auditEvents.targetId, 'guest')));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('view-role and guest-view cookies are exclusive; view-role wins when both present', async () => {
    const f = await seed('vr2');
    const db = await getDb();
    await seedPreviewPersonas(db);
    const owner = await signIn(f.emails.admin, {}, 'admin_sign_in');
    const role = expectOk(await call<Minted>('admin_set_view_role', { role: 'household_manager' }, { cookie: owner.cookie })).data;
    const guest = expectOk(await call<{ token: string }>('admin_browse_as_guest', { guestId: f.guests.ana }, { cookie: owner.cookie })).data;
    const both = `${owner.cookie}; ${VIEW_ROLE_COOKIE}=${encodeURIComponent(role.token)}; ${GUEST_VIEW_COOKIE}=${encodeURIComponent(guest.token)}`;
    const p = await principalFor({ cookie: both, pathname: '/' });
    expect(p.kind === 'guest' && p.viewedBy?.previewRole).toBe('household_manager');
  });

  it('non-admins cannot mint a view-role token', async () => {
    const f = await seed('vr3');
    const db = await getDb();
    await seedPreviewPersonas(db);
    const ana = await claim(f.invitations.ruiz.token, f.guests.ana, f.emails.ana);
    expectErr(await call('admin_set_view_role', { role: 'guest' }, { cookie: ana.cookie }), 'forbidden');
  });

  it('lists available roles', async () => {
    const f = await seed('vr4');
    const owner = await signIn(f.emails.admin, {}, 'admin_sign_in');
    const list = expectOk(await call<{ roles: { role: string; label: string }[] }>('admin_list_view_roles', {}, { cookie: owner.cookie, method: 'GET' }));
    expect(list.data.roles.map((r) => r.role)).toEqual(['guest', 'plus_one', 'household_manager', 'party']);
  });
});

describe('admin view-role preview — planner role', () => {
  it('planners may preview roles without guest-ops', async () => {
    await seed('vr5');
    const db = await getDb();
    await seedPreviewPersonas(db);
    const email = `planner+vr5@example.test`;
    await grantAdmin(email, 'planner');
    const planner = await signIn(email, {}, 'admin_sign_in');
    const minted = expectOk(await call<Minted>('admin_set_view_role', { role: 'party' }, { cookie: planner.cookie }));
    const p = await principalFor({ cookie: withRole(planner.cookie, minted.data.token), pathname: '/rsvp' });
    expect(p.kind).toBe('guest');
  });
});
