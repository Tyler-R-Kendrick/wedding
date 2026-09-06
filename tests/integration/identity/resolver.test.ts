import { describe, expect, it } from 'vitest';
import { registry } from '@/capabilities';
import { getDb } from '@/db/client';
import { ensureAuthUser } from '@/domain/identity/bindings';
import { getAuth } from '@/lib/auth';
import { call, claim, expectErr, expectOk, grantAdmin, principalFor, seed, signIn } from './harness';

describe('principal resolver', () => {
  it('anonymous without a cookie, with a garbage cookie, or with an unbound identity', async () => {
    expect((await principalFor()).kind).toBe('anonymous');
    expect((await principalFor({ cookie: 'wedding.session_token=garbage.garbage' })).kind).toBe('anonymous');
    const db = await getDb();
    const user = await ensureAuthUser(db, 'nobody+rs1@example.test');
    if (!user.ok) throw user.error;
    const auth = await getAuth(db);
    const ctx = await auth.$context;
    const session = await ctx.internalAdapter.createSession(user.value.id);
    expect((await principalFor({ cookie: `wedding.session_token=${session.token}` })).kind).toBe('anonymous'); // unsigned cookie
  });

  it('CSRF: a cross-site mutation with a valid session resolves to anonymous; reads and same-origin pass', async () => {
    const f = await seed('rs2');
    const ana = await claim(f.invitations.ruiz.token, f.guests.ana, f.emails.ana);
    expect((await principalFor({ cookie: ana.cookie })).kind).toBe('guest');
    expect((await principalFor({ cookie: ana.cookie, origin: 'https://evil.example' })).kind).toBe('anonymous');
    expect((await principalFor({ cookie: ana.cookie, origin: 'https://evil.example', method: 'GET' })).kind).toBe('guest');
    // Accepted exception (review N10): a cookie POST with neither Origin nor Sec-Fetch-Site (legacy browsers, API clients)
    // is trusted by the resolver; the capabilities route additionally requires same-origin JSON for authenticated POSTs.
    expect((await principalFor({ cookie: ana.cookie, origin: null })).kind).toBe('guest');
    expectErr(await call('get_my_invitation', {}, { cookie: ana.cookie, origin: 'https://evil.example' }), 'unauthenticated');
  });

  it('admin allowlist/roles produce an AdminPrincipal, never a guest, even if the email is also a guest', async () => {
    const f = await seed('rs3');
    await grantAdmin(f.emails.ana, 'planner');
    const ana = await claim(f.invitations.ruiz.token, f.guests.ana, f.emails.ana);
    const p = await principalFor({ cookie: ana.cookie });
    expect(p.kind).toBe('admin');
    expectErr(await call('get_my_invitation', {}, { cookie: ana.cookie }), 'forbidden');
  });

  it('describe/list snapshots per role: anonymous, guest, household manager, admin', async () => {
    const f = await seed('rs4');
    const names = (p: Parameters<typeof registry.list>[0]) => registry.list(p).map((c) => c.name).filter((n) => !n.startsWith('site_') && n !== 'navigate_to');
    // Exact lists on purpose: this is the guard that a capability never becomes visible to a
    // lesser principal by accident. When a level adds one, update these deliberately and say why.
    // Level 05 added the public content reads (story, adventures, itineraries, venue, FAQ, static
    // search) — anonymous by design, since those are public pages, and agent-exposed so the
    // concierge can answer from them.
    expect(names({ principal: { kind: 'anonymous' } })).toEqual(['find_adventures', 'get_faq', 'get_story', 'get_venue_facts', 'list_adventures', 'list_itineraries', 'lookup_invitation', 'request_otp', 'search_wedding_information_static', 'show_adventure', 'show_venue_room', 'verify_otp']);
    const amara = await signIn(f.emails.amara);
    const guest = await principalFor({ cookie: amara.cookie });
    expect(names({ principal: guest })).toEqual(['claim_identity', 'find_adventures', 'get_faq', 'get_my_household', 'get_my_invitation', 'get_story', 'get_venue_facts', 'list_adventures', 'list_itineraries', 'lookup_invitation', 'register_passkey', 'request_otp', 'search_wedding_information_static', 'show_adventure', 'show_venue_room', 'step_up', 'update_my_contact', 'verify_otp']);
    expect(names({ principal: guest, exposure: 'ai' })).toEqual(['find_adventures', 'get_faq', 'get_my_household', 'get_my_invitation', 'get_story', 'get_venue_facts', 'list_adventures', 'list_itineraries', 'search_wedding_information_static', 'show_adventure', 'show_venue_room']);
    expect(names({ principal: guest, exposure: 'webmcp' })).toEqual(['find_adventures', 'get_faq', 'get_my_household', 'get_my_invitation', 'get_story', 'get_venue_facts', 'list_adventures', 'list_itineraries', 'search_wedding_information_static', 'show_adventure', 'show_venue_room']);
    await grantAdmin(`owner+rs4@example.test`, 'owner');
    const admin = await signIn(`owner+rs4@example.test`, {}, 'admin_sign_in');
    const ap = await principalFor({ cookie: admin.cookie });
    // Identity's admin surface only: level 05's content editors are named without the prefix
    // (list_content_records, save_content_record, ...) and are covered by their own level's tests.
    expect(names({ principal: ap }).filter((n) => n.startsWith('admin_'))).toHaveLength(17);
    expect(names({ principal: ap, exposure: 'ai' }).filter((n) => n.startsWith('admin_'))).toEqual([]);
    const inv = expectOk(await call<{ you: { isManager: boolean } }>('get_my_invitation', {}, { cookie: amara.cookie }));
    expect(inv.data.you.isManager).toBe(false);
  });
});
