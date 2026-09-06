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
    // Level 08 (travel) is the first level since 05 to add to this list, and each of the three was
    // checked one by one rather than accepted as a set:
    //   * `list_hotel_recommendations` — the curated hotels and venue facts on the public /travel
    //     page. The room-block link, rate, dates and cutoff stay unpublished until the planner
    //     confirms them, so the negotiated rate is not given away by this being public.
    //   * `search_travel_options` — the public travel page's own search. Read-only, and anonymous
    //     traffic to it is metered per client IP at the JSON route.
    //   * `open_booking_link` — deep links to allow-listed partners. It is `external` and
    //     `consequentialHint`, and its one guest-only variant (`hosted_flights`, which creates a
    //     trip item) is refused to an anonymous caller by `requireGuestWriter` INSIDE the handler,
    //     because an `auth: 'anonymous'` descriptor means the pipeline does not reject first. That
    //     guard is what `tests/integration/travel.test.ts` exercises: neutering it makes that test
    //     fail, which was checked rather than assumed.
    // Nothing guest-specific joined this list: profiles, the trip bridge and every admin travel
    // capability require a signed-in principal and an entitlement.
    expect(names({ principal: { kind: 'anonymous' } })).toEqual(['find_adventures', 'get_faq', 'get_story', 'get_venue_facts', 'list_adventures', 'list_hotel_recommendations', 'list_itineraries', 'lookup_invitation', 'open_booking_link', 'request_otp', 'search_travel_options', 'search_wedding_information_static', 'show_adventure', 'show_venue_room', 'verify_otp']);
    const amara = await signIn(f.emails.amara);
    // Level 08 (travel) adds 7 guest capabilities, all `auth: 'guest'` behind `view_travel_tools`,
    // and every mutating one carries `confirmation: 'inline'`. `update_trip_item` is the one absent
    // from the ai/webmcp lists: editing an existing booking record is the operation where an
    // assistant's mistake is hardest for a guest to notice, so it stays a website action.
    // Level 07 (RSVP/seating) adds 5 guest capabilities and 17 admin ones. Checked one by one before
    // updating these lists: every new guest capability is `auth: 'guest'` behind an entitlement, and
    // the ANONYMOUS list above is unchanged — level 07 exposes nothing publicly. `submit_rsvp` is
    // absent from the ai/webmcp lists because it is a UI-only transaction, and `get_my_table` /
    // `show_my_table_on_floorplan` are absent from the guest list because this fixture guest has no
    // `view_table_assignment` — both are the entitlement gate working, not an omission.
    const guest = await principalFor({ cookie: amara.cookie });
    expect(names({ principal: guest })).toEqual(['add_trip_item', 'claim_identity', 'delete_my_travel_profile', 'draft_rsvp', 'find_adventures', 'get_faq', 'get_my_household', 'get_my_invitation', 'get_my_itinerary', 'get_my_rsvp', 'get_my_travel_profile', 'get_my_trip', 'get_story', 'get_venue_facts', 'list_adventures', 'list_hotel_recommendations', 'list_itineraries', 'list_my_events', 'lookup_invitation', 'open_booking_link', 'register_passkey', 'remove_trip_item', 'request_otp', 'search_travel_options', 'search_wedding_information_static', 'show_adventure', 'show_venue_room', 'step_up', 'submit_rsvp', 'update_my_contact', 'update_my_travel_profile', 'update_trip_item', 'verify_otp']);
    expect(names({ principal: guest, exposure: 'ai' })).toEqual(['add_trip_item', 'delete_my_travel_profile', 'draft_rsvp', 'find_adventures', 'get_faq', 'get_my_household', 'get_my_invitation', 'get_my_itinerary', 'get_my_rsvp', 'get_my_travel_profile', 'get_my_trip', 'get_story', 'get_venue_facts', 'list_adventures', 'list_hotel_recommendations', 'list_itineraries', 'list_my_events', 'open_booking_link', 'remove_trip_item', 'search_travel_options', 'search_wedding_information_static', 'show_adventure', 'show_venue_room', 'update_my_travel_profile']);
    expect(names({ principal: guest, exposure: 'webmcp' })).toEqual(['add_trip_item', 'delete_my_travel_profile', 'draft_rsvp', 'find_adventures', 'get_faq', 'get_my_household', 'get_my_invitation', 'get_my_itinerary', 'get_my_rsvp', 'get_my_travel_profile', 'get_my_trip', 'get_story', 'get_venue_facts', 'list_adventures', 'list_hotel_recommendations', 'list_itineraries', 'list_my_events', 'open_booking_link', 'remove_trip_item', 'search_travel_options', 'search_wedding_information_static', 'show_adventure', 'show_venue_room', 'update_my_travel_profile']);
    await grantAdmin(`owner+rs4@example.test`, 'owner');
    const admin = await signIn(`owner+rs4@example.test`, {}, 'admin_sign_in');
    const ap = await principalFor({ cookie: admin.cookie });
    // Identity's admin surface only: level 05's content editors are named without the prefix
    // (list_content_records, save_content_record, ...) and are covered by their own level's tests.
    // 34 → 39: level 08's five travel editors (hotels and partner links), all `admin_content`,
    // all website-only. No travel capability is exposed to an assistant on the admin surface.
    expect(names({ principal: ap }).filter((n) => n.startsWith('admin_'))).toHaveLength(39);
    expect(names({ principal: ap, exposure: 'ai' }).filter((n) => n.startsWith('admin_'))).toEqual([]);
    const inv = expectOk(await call<{ you: { isManager: boolean } }>('get_my_invitation', {}, { cookie: amara.cookie }));
    expect(inv.data.you.isManager).toBe(false);
  });
});
