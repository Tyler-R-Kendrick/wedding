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
        // Level 09 (transport, gifts, reservations) adds five, each checked rather than accepted:
    //   * `list_gift_links`, `open_gift_link`, `get_reservation_options`, `open_reservation_link` —
    //     the public /gifts page and its partner hand-offs. Curated, admin-entered links that pass
    //     the redirect allowlist; no guest data in any of them.
    //   * `get_my_transportation_options` — the name says "my", so this is the one that mattered.
    //     Its handler returns `benefits: []` unless the principal is a guest, and that is not merely
    //     a runtime check: `benefitViewsFor` takes a `GuestPrincipal`, so passing an anonymous
    //     principal does not compile. Asserted at `transport-claims.test.ts` ("signedIn: false,
    //     benefits: []") as well. The public part is valet, transit and parking, which is public.
    // Every claim capability stays `auth: 'guest'` behind `claim_transportation_benefit`.
    //
    // Level 10 (media) adds exactly two anonymous names, and both earn it: `/photos` is a public
    // page, so a visitor must be able to list albums and open an item. What makes that safe is the
    // ACL, not the `auth` line — `canViewVisibility` returns true for an anonymous principal only
    // when the effective visibility is `public`, every other case requires `kind === 'guest'`, and
    // `canViewPublishedAsset` demands `status === 'published'` first. `list_gallery` 404s a
    // collection the principal cannot see rather than revealing that it exists, and (as of this
    // integration) filters each asset by its OWN visibility too — it previously trusted the
    // collection's, which would have listed a `private` asset in a public album to anyone.
    // Every upload, delete and moderation capability stays `auth: 'guest'` or `auth: 'admin'`.
    //
    // Level 11 (media AI + biometrics) adds exactly ONE anonymous name, `search_media`, because
    // `/media/search` is a public page. It earns it the same way the level-10 pair did, through the
    // ACL rather than the `auth` line: `src/domain/mediaai/search.ts:74` re-checks
    // `canViewPublishedAsset(principal, asset, collection)` on EVERY hit — the same function level
    // 10 had to fix — so an anonymous caller can only ever see assets that are both `published` and
    // effectively `public`. It is `readOnlyHint: true` and `untrustedContentHint: true`, the latter
    // because a hit carries guest captions and model-suggested text.
    //
    // Not anonymous, and worth stating because this is the level that could have got it wrong: all
    // TWELVE biometric capabilities are `ui: true, ai: false, webmcp: false`, so no assistant and no
    // WebMCP client can enrol a face, run a match, read a consent, or trigger a deletion. Nothing
    // face-related appears on any list below.
    // Level 12 adds three concierge capabilities. Two are anonymous and flag-gated (`AI_CONCIERGE`):
    // `ask_concierge`, which is `ai: false` so the concierge can never call itself, and
    // `search_wedding_information`, the retrieval tool that IS on the AI surface. The third,
    // `list_ai_traces`, is `auth: 'admin'` behind `admin_ai` and website-only, so it appears in no
    // guest list and adds nothing to the AI surface. In the same change
    // `search_wedding_information_static` drops to `ai: false`: it has an input schema identical to
    // the new tool's, so leaving both model-visible gave the router two indistinguishable choices.
    // It keeps `ui` (the no-JavaScript /ask-us form calls it server-side) and `webmcp`.
    expect(names({ principal: { kind: 'anonymous' } })).toEqual(['ask_concierge', 'find_adventures', 'get_faq', 'get_media_item', 'get_my_transportation_options', 'get_reservation_options', 'get_story', 'get_venue_facts', 'list_adventures', 'list_gallery', 'list_gift_links', 'list_hotel_recommendations', 'list_itineraries', 'lookup_invitation', 'open_booking_link', 'open_gift_link', 'open_reservation_link', 'request_otp', 'search_media', 'search_travel_options', 'search_wedding_information', 'search_wedding_information_static', 'show_adventure', 'show_venue_room', 'verify_otp']);
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
    // Level 09 adds 8 guest capabilities. All are `auth: 'guest'`; the two that issue anything are
    // behind `claim_transportation_benefit`, and `claim_my_transportation_benefit` additionally
    // carries `stepUp: true` and `confirmation: 'explicit'`. It is exposed to ai/webmcp, which looks
    // wrong for a money-adjacent action until you follow the pipeline: `invoke` refuses an explicit
    // confirmation on any surface but `ui` ("models and WebMCP can only draft"), so an assistant can
    // describe and draft a claim but can never redeem one. That is the same guarantee level 07
    // relied on to leave `submit_rsvp` off the agent lists, reached a different way.
    // Level 10 (media) adds 8 guest capabilities. Only the three READS reach an assistant:
    // `list_gallery`, `get_media_item` and `list_my_uploads`. Every mutating one — create, complete,
    // resume, abort and delete an upload — is `ui: true, ai: false, webmcp: false`, so no agent can
    // start, finish, cancel or destroy a guest's upload; `delete_my_upload` additionally carries
    // `confirmation: 'inline'`. Swarm H chose that itself, and it is the right line: an upload is
    // the one thing on this site a guest cannot recreate.
    const guest = await principalFor({ cookie: amara.cookie });
    // Level 11 adds five guest names. Three are the biometric ones a guest keeps EVEN WITH THE
    // FEATURE OFF — read my consent, withdraw it, ask for deletion — because those obligations
    // outlive the feature (ADR-0006 §5); the four that would actually touch a face all require
    // `use_face_matching`, which policy grants only to an invited guest while BIOMETRICS_ENABLED is
    // on, so they are absent here as they should be. The other two are reads: `search_media`, and
    // `suggest_alt_text`, which proposes alt text for a guest's own upload and is
    // `ui: true, ai: false, webmcp: false` — a suggestion a person accepts, never applied for them.
    expect(names({ principal: guest })).toEqual(['abort_upload', 'add_trip_item', 'ask_concierge', 'claim_identity', 'claim_my_transportation_benefit', 'complete_upload', 'create_upload', 'delete_my_travel_profile', 'delete_my_upload', 'draft_my_transportation_claim', 'draft_rsvp', 'find_adventures', 'get_faq', 'get_media_item', 'get_my_biometric_consent', 'get_my_household', 'get_my_invitation', 'get_my_itinerary', 'get_my_rsvp', 'get_my_transportation_options', 'get_my_travel_profile', 'get_my_trip', 'get_reservation_options', 'get_story', 'get_venue_facts', 'list_adventures', 'list_gallery', 'list_gift_links', 'list_hotel_recommendations', 'list_itineraries', 'list_my_events', 'list_my_uploads', 'lookup_invitation', 'open_booking_link', 'open_gift_link', 'open_reservation_link', 'prepare_reservation', 'register_passkey', 'remove_trip_item', 'request_biometric_deletion', 'request_otp', 'resume_upload', 'revoke_biometric_consent', 'search_media', 'search_travel_options', 'search_wedding_information', 'search_wedding_information_static', 'show_adventure', 'show_venue_room', 'step_up', 'submit_rsvp', 'suggest_alt_text', 'update_my_contact', 'update_my_travel_profile', 'update_trip_item', 'verify_otp']);
    // `search_media` is the ONE level-11 capability an assistant may call. It is a read, its hits
    // are re-checked per asset against the caller's own ACL, and its output is marked untrusted
    // because it carries guest captions and model-suggested text. Nothing biometric is here.
    expect(names({ principal: guest, exposure: 'ai' })).toEqual(['add_trip_item', 'claim_my_transportation_benefit', 'delete_my_travel_profile', 'draft_my_transportation_claim', 'draft_rsvp', 'find_adventures', 'get_faq', 'get_media_item', 'get_my_household', 'get_my_invitation', 'get_my_itinerary', 'get_my_rsvp', 'get_my_transportation_options', 'get_my_travel_profile', 'get_my_trip', 'get_reservation_options', 'get_story', 'get_venue_facts', 'list_adventures', 'list_gallery', 'list_gift_links', 'list_hotel_recommendations', 'list_itineraries', 'list_my_events', 'list_my_uploads', 'open_booking_link', 'open_gift_link', 'open_reservation_link', 'prepare_reservation', 'remove_trip_item', 'search_media', 'search_travel_options', 'search_wedding_information', 'show_adventure', 'show_venue_room', 'update_my_travel_profile']);
    expect(names({ principal: guest, exposure: 'webmcp' })).toEqual(['add_trip_item', 'ask_concierge', 'claim_my_transportation_benefit', 'delete_my_travel_profile', 'draft_my_transportation_claim', 'draft_rsvp', 'find_adventures', 'get_faq', 'get_media_item', 'get_my_household', 'get_my_invitation', 'get_my_itinerary', 'get_my_rsvp', 'get_my_transportation_options', 'get_my_travel_profile', 'get_my_trip', 'get_reservation_options', 'get_story', 'get_venue_facts', 'list_adventures', 'list_gallery', 'list_gift_links', 'list_hotel_recommendations', 'list_itineraries', 'list_my_events', 'list_my_uploads', 'open_booking_link', 'open_gift_link', 'open_reservation_link', 'prepare_reservation', 'remove_trip_item', 'search_media', 'search_travel_options', 'search_wedding_information', 'search_wedding_information_static', 'show_adventure', 'show_venue_room', 'update_my_travel_profile']);
    await grantAdmin(`owner+rs4@example.test`, 'owner');
    const admin = await signIn(`owner+rs4@example.test`, {}, 'admin_sign_in');
    const ap = await principalFor({ cookie: admin.cookie });
    // Identity's admin surface only: level 05's content editors are named without the prefix
    // (list_content_records, save_content_record, ...) and are covered by their own level's tests.
    // 34 → 39: level 08's five travel editors (hotels and partner links), all `admin_content`,
    // all website-only. No travel capability is exposed to an assistant on the admin surface.
    // 39 -> 48: level 09's nine admin capabilities, each behind the entitlement that matches what it
    // touches rather than a blanket one — guest records under `admin_guest_ops` (assign, revoke and
    // list transportation entitlements), the voucher code pool under `admin_integrations` (it holds
    // provider secrets), and the curated gift and reservation links under `admin_content`.
    // 48 -> 53: level 10's five media admin capabilities — the moderation queue, the moderation
    // action, the professional import, and the duplicates and metrics views. All five are
    // `auth: 'admin'` behind `admin_media`, the entitlement that matches what they touch: guest
    // photographs and the vendors' originals. None is exposed to an assistant.
    // 53 -> 60: level 11 adds seven admin capabilities, counted rather than accepted — three for
    // media AI (`admin_apply_media_text`, `admin_media_ai_status`, `admin_reindex_media`) and four
    // for the biometric gate (`admin_biometric_status`, `admin_delete_biometric_data`,
    // `admin_enable_biometric_readiness`, `admin_disable_biometric_readiness`). The assertion below
    // is the one that matters: not one of the sixty reaches an assistant.
    // 60 -> 70: level 14's ten `admin_`-prefixed console capabilities — `admin_lifecycle_status`,
    // `admin_publish_lifecycle` (`admin_lifecycle`); `admin_search_audit` (`admin_audit`);
    // `admin_jobs_overview`, `admin_retry_job`, `admin_cancel_job`, `admin_ops_metrics`,
    // `admin_provider_status` (`admin_integrations`); `admin_flag_status`,
    // `admin_disable_flag_readiness` (`admin_lifecycle`). The eleventh, `draft_lifecycle_transition`,
    // has no prefix and so is not counted here — the count is of the `admin_` namespace, not of the
    // level. Every one of the eleven is `ui: true, ai: false, webmcp: false`, which is what the
    // second assertion checks and what matters: publishing a lifecycle state, retrying a job and
    // moving a readiness switch are not things an assistant may reach for.
    expect(names({ principal: ap }).filter((n) => n.startsWith('admin_'))).toHaveLength(70);
    expect(names({ principal: ap, exposure: 'ai' }).filter((n) => n.startsWith('admin_'))).toEqual([]);
    // Level 15. The counts above are of the `admin_` namespace, so nothing here ever pinned the
    // GUEST-facing capabilities an admin's list also contains — and `meetsAuthLevel('guest', admin)`
    // is true, so seven of them were listed for an admin whose handler then refuses:
    // claim_identity, get_my_biometric_consent, get_my_household, get_my_invitation,
    // request_biometric_deletion, revoke_biometric_consent, update_my_contact. The three biometric
    // ones are the surprise: they carry no `flag` on purpose, because revoking consent and
    // requesting deletion must stay reachable when the feature is off (BIPA), so they were listed
    // for an admin today rather than only hypothetically. `guestIdentityRequired` refuses all seven
    // in authorize(). What remains is the honest list: capabilities an admin can genuinely run.
    // `prepare_reservation`, `register_passkey`, `step_up` and `suggest_alt_text` are `auth: 'guest'`
    // in the sense of "a signed-in principal", and each admits an admin by design.
    // `names()` above already drops `site_*` and `navigate_to`, which every principal can reach.
    expect(names({ principal: ap }).filter((n) => !n.startsWith('admin_'))).toEqual([
      'ask_concierge', 'draft_biometric_readiness', 'draft_lifecycle_transition', 'find_adventures',
      'get_content_record', 'get_faq', 'get_media_clusters', 'get_media_item',
      'get_my_transportation_options', 'get_reservation_options', 'get_story', 'get_venue_facts',
      'list_adventures', 'list_ai_traces', 'list_content_records', 'list_gallery', 'list_gift_links',
      'list_hotel_recommendations', 'list_itineraries', 'lookup_invitation', 'mark_content_verified',
      'open_booking_link', 'open_gift_link', 'open_reservation_link',
      'prepare_reservation', 'register_passkey', 'request_otp', 'save_content_record', 'search_media',
      'search_travel_options', 'search_wedding_information', 'search_wedding_information_static',
      'show_adventure', 'show_venue_room', 'step_up', 'suggest_alt_text', 'verify_otp',
    ]);
    const inv = expectOk(await call<{ you: { isManager: boolean } }>('get_my_invitation', {}, { cookie: amara.cookie }));
    expect(inv.data.you.isManager).toBe(false);
  });
});
