import { afterAll, describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { adminListExternalActions } from '@/capabilities/admin_external_actions';
import { adminUpsertGiftLink } from '@/capabilities/admin_gifts';
import { adminUpsertReservationVenue } from '@/capabilities/admin_reservations';
import { getReservationOptions } from '@/capabilities/get_reservation_options';
import { listGiftLinksCapability } from '@/capabilities/list_gift_links';
import { openGiftLink } from '@/capabilities/open_gift_link';
import { openReservationLink } from '@/capabilities/open_reservation_link';
import { prepareReservation } from '@/capabilities/prepare_reservation';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId, IdempotencyKey } from '@/contracts/ids';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { externalActionRecords, giftLinks, reservationVenues } from '@/db/schema';
import { FORBIDDEN_GIFT_WORDS } from '@/domain/gifts/copy';
import { listAuditEvents } from '@/lib/audit';
import { resetProviders } from '@/providers/registry';

const guest: GuestPrincipal = { kind: 'guest', authIdentityId: 'a' as AuthIdentityId, guestId: newId<GuestId>(), householdId: newId<HouseholdId>(), actsFor: [], entitlements: new Set(['view_event']), authenticatedAt: new Date().toISOString(), sessionId: 's' };
guest.actsFor.push(guest.guestId);
const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'b' as AuthIdentityId, adminId: 'A1' as AdminId, roles: new Set(['owner']), entitlements: new Set(['admin_content', 'admin_audit']), authenticatedAt: new Date().toISOString(), sessionId: 's' };
const anon: Principal = { kind: 'anonymous' };
let n = 0;
async function run<I, O>(descriptor: Parameters<typeof invoke<I, O>>[0], principal: Principal, input: unknown, extra: { idempotencyKey?: string; surface?: 'ui' | 'ai' | 'webmcp'; requestId?: string } = {}) {
  const ctx = await createCapabilityContext({ principal, requestId: extra.requestId ?? `req-gr-${++n}`, surface: extra.surface ?? 'ui', idempotencyKey: extra.idempotencyKey });
  return invoke(descriptor, ctx, input);
}
const key = () => newId<IdempotencyKey>();
const EVIL = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://www.zola.com/', 'https://evil.example/', 'https://zola.com.evil.example/', 'https://www.google.com/search?q=x', 'https://user:pw@www.zola.com/'];

afterAll(() => resetProviders());

describe('gifts', () => {
  it('lists placeholder links with the brief’s language and no forbidden words', async () => {
    const r = await run(listGiftLinksCapability, anon, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.copy.title).toBe('Help us with our next adventures');
    expect(r.value.data.links.map((l) => [l.kind, l.placeholder, l.host, l.origin])).toEqual([
      ['registry', true, 'www.zola.com', 'placeholder'],
      ['adventure-fund', true, 'www.zola.com', 'placeholder'],
    ]);
    const text = JSON.stringify(r.value.data.copy);
    for (const re of FORBIDDEN_GIFT_WORDS) expect(text).not.toMatch(re);
    expect(r.value.sources[0]?.url).toBe('/the-wedding');
  });

  it('records a handoff (host only) when a link is opened, never a purchase', async () => {
    const r = await run(openGiftLink, anon, { linkId: 'registry-placeholder' }, { requestId: 'req-gift-open' });
    expect(r.ok && r.value.handoffUrl).toBe('https://www.zola.com/');
    expect(r.ok && r.value.data.handoff).toMatchObject({ providerDisplayName: 'Zola', opensNewTab: true });
    const db = await getDb();
    const rec = (await db.select().from(externalActionRecords)).find((x) => x.kind === 'gift_link');
    expect(rec).toMatchObject({ status: 'initiated', provider: 'zola', urlHost: 'www.zola.com', actor: { kind: 'anonymous' }, targetId: 'registry-placeholder', requestId: 'req-gift-open' });
    const audit = await listAuditEvents(db, { requestId: 'req-gift-open' });
    expect(audit.map((e) => e.action).sort()).toEqual(['capability.invoked', 'external_action.initiated']);
    expect((await run(openGiftLink, anon, { linkId: 'nope' })).ok).toBe(false);
    expect((await run(openGiftLink, anon, { linkId: '../etc' })).ok).toBe(false);
    const ai = await run(openGiftLink, anon, { linkId: 'registry-placeholder' }, { surface: 'ai' });
    expect(ai.ok && ai.value.handoffUrl).toBe('https://www.zola.com/');
  });

  it('admin links must be on the allowlist at write time AND at read time (open-redirect guard)', async () => {
    for (const url of EVIL) {
      const r = await run(adminUpsertGiftLink, admin, { id: 'bad-link', kind: 'registry', provider: 'custom', label: 'x', url }, { idempotencyKey: key() });
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('validation');
    }
    const good = await run(adminUpsertGiftLink, admin, { id: 'knot-registry', kind: 'registry', provider: 'theknot', label: 'Our registry on The Knot', url: 'https://www.theknot.com/us/sara-and-tyler', note: 'Physical wishlist' }, { idempotencyKey: key() });
    expect(good.ok).toBe(true);
    const asGuest = await run(adminUpsertGiftLink, guest, { id: 'g', kind: 'registry', provider: 'zola', label: 'x', url: 'https://www.zola.com/' }, { idempotencyKey: key() });
    expect(!asGuest.ok && asGuest.error.code).toBe('forbidden');
    // Tampered row written behind the capability layer: dropped on read.
    const db = await getDb();
    await db.insert(giftLinks).values({ id: 'tampered', kind: 'registry', provider: 'custom', label: 'Evil', url: 'https://evil.example/pay', placeholder: false, active: true, sortOrder: 5, updatedBy: { kind: 'system', component: 'test' } });
    const list = await run(listGiftLinksCapability, anon, {});
    expect(list.ok && list.value.data.links.map((l) => [l.id, l.kind, l.origin, l.placeholder])).toEqual([
      ['knot-registry', 'registry', 'admin', false],
      ['adventure-fund-placeholder', 'adventure-fund', 'placeholder', true],
    ]);
    expect(JSON.stringify(list)).not.toContain('evil.example');
    expect((await run(openGiftLink, anon, { linkId: 'tampered' })).ok).toBe(false);
    const opened = await run(openGiftLink, anon, { linkId: 'knot-registry' });
    expect(opened.ok && opened.value.data.handoff.providerDisplayName).toBe('The Knot');
  });

  it('never prints the authoring marker in a label a guest reads', async () => {
    // The label is the hand-off card's heading and its button text. An admin who types the marker
    // into the label field is saying "not final yet" — that belongs in `placeholder`, which renders
    // as the editorial sentence, not as `TODO(...)` on a public page.
    const r = await run(
      adminUpsertGiftLink,
      admin,
      { id: 'marker-registry', kind: 'registry', provider: 'zola', label: 'TODO(Tyler & Sara): registry link (backlog C-09)', url: 'https://www.zola.com/registry/x', placeholder: true },
      { idempotencyKey: key() },
    );
    expect(r.ok).toBe(true);
    const list = await run(listGiftLinksCapability, anon, {});
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const link = list.value.data.links.find((l) => l.id === 'marker-registry');
    expect(link).toBeDefined();
    expect(link?.placeholder).toBe(true);
    expect(link?.label).toBe('registry link');
    expect(JSON.stringify(list.value.data.links)).not.toContain('TODO(');
  });
});

describe('reservations ladder', () => {
  it('answers with the url rung for Cindy’s and an honest unavailable rung for the placeholder', async () => {
    const r = await run(getReservationOptions, anon, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.retrievedAt).toBeTruthy();
    expect(r.value.data.options.map((o) => [o.venue.id, o.rung, o.canCommit, o.handoff?.host ?? null])).toEqual([
      ['caa-cindys', 'url', false, 'www.chicagoathletichotel.com'],
      ['placeholder-restaurant', 'unavailable', false, null],
    ]);
    expect(r.value.data.options[1]!.unavailable).toEqual({ message: expect.stringMatching(/Ask us/), contactRoute: '/ask-us' });
    expect(r.value.sources.map((s) => s.title).sort()).toEqual(["Tyler's brief 2026-09-04", 'chicagoathletichotel.com']);
    const missing = await run(getReservationOptions, anon, { venueId: 'nowhere' });
    expect(!missing.ok && missing.error.code).toBe('not_found');
  });

  it('unavailable rung: open_reservation_link returns no handoff and records nothing', async () => {
    const r = await run(openReservationLink, anon, { venueId: 'placeholder-restaurant' });
    expect(r.ok && r.value.data).toMatchObject({ rung: 'unavailable', unavailable: { contactRoute: '/ask-us' } });
    expect(r.ok && r.value.handoffUrl).toBeUndefined();
    const db = await getDb();
    expect((await db.select().from(externalActionRecords)).filter((x) => x.kind === 'reservation_link')).toHaveLength(0);
  });

  it('admin-configured deep links climb the ladder; bad URLs are rejected or dropped', async () => {
    for (const url of EVIL) {
      const r = await run(adminUpsertReservationVenue, admin, { id: 'bad-venue', name: 'Bad', url }, { idempotencyKey: key() });
      expect(r.ok, url).toBe(false);
    }
    for (const slug of ['../x', 'a b', 'x/y']) {
      expect((await run(adminUpsertReservationVenue, admin, { id: 'v', name: 'V', resySlug: slug }, { idempotencyKey: key() })).ok, slug).toBe(false);
    }
    const resy = await run(adminUpsertReservationVenue, admin, { id: 'test-resy', name: 'Test Resy Place', resySlug: 'test-resy-place', note: 'fixture' }, { idempotencyKey: key() });
    expect(resy.ok).toBe(true);
    const ot = await run(adminUpsertReservationVenue, admin, { id: 'test-ot', name: 'Test OpenTable Place', openTableId: 'test-ot-place' }, { idempotencyKey: key() });
    expect(ot.ok).toBe(true);
    const db = await getDb();
    await db.insert(reservationVenues).values({ id: 'tampered-venue', name: 'Tampered', url: 'https://evil.example/book', placeholder: false, active: true, sortOrder: 9, updatedBy: { kind: 'system', component: 'test' } });

    const opts = await run(getReservationOptions, anon, { date: '2027-07-16', partySize: 4 });
    expect(opts.ok).toBe(true);
    if (!opts.ok) return;
    const byId = Object.fromEntries(opts.value.data.options.map((o) => [o.venue.id, o]));
    expect(byId['test-resy']).toMatchObject({ rung: 'deep-link', handoff: { host: 'resy.com', providerDisplayName: 'Resy' } });
    expect(byId['test-resy']!.handoff!.url).toBe('https://resy.com/cities/chi/test-resy-place?date=2027-07-16&seats=4');
    expect(byId['test-ot']).toMatchObject({ rung: 'deep-link', handoff: { host: 'www.opentable.com', providerDisplayName: 'OpenTable' } });
    expect(byId['tampered-venue']).toMatchObject({ rung: 'unavailable' });
    expect(JSON.stringify(opts)).not.toContain('evil.example');
    expect(byId['caa-cindys']).toBeUndefined(); // admin rows replace the built-in defaults

    const open = await run(openReservationLink, anon, { venueId: 'test-resy', date: '2027-07-16', partySize: 2 }, { requestId: 'req-res-open' });
    expect(open.ok && open.value.handoffUrl).toBe('https://resy.com/cities/chi/test-resy-place?date=2027-07-16&seats=2');
    const rec = (await db.select().from(externalActionRecords)).find((x) => x.kind === 'reservation_link');
    expect(rec).toMatchObject({ provider: 'resy', status: 'initiated', urlHost: 'resy.com', targetId: 'test-resy', metadata: { rung: 'deep-link', partySize: 2, date: '2027-07-16' } });
    expect(JSON.stringify(rec)).not.toContain('seats='); // host only, never the full deep link
    const tamperedOpen = await run(openReservationLink, anon, { venueId: 'tampered-venue' });
    expect(tamperedOpen.ok && tamperedOpen.value.handoffUrl).toBeUndefined();
    expect((await run(openReservationLink, anon, { venueId: 'x', date: '16/07/2027' })).ok).toBe(false);
  });

  it('prepare_reservation builds the card for a signed-in guest and keeps contact details out of records', async () => {
    const anonPrep = await run(prepareReservation, anon, { venueId: 'test-resy', date: '2027-07-16', time: '19:00', partySize: 2, contactName: 'Pat Example' });
    expect(!anonPrep.ok && anonPrep.error.code).toBe('unauthenticated');
    const prep = await run(prepareReservation, guest, { venueId: 'test-resy', date: '2027-07-16', time: '19:00', partySize: 2, contactName: 'Pat Example' }, { requestId: 'req-res-prep' });
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(prep.value.data).toMatchObject({ card: { venue: { id: 'test-resy' }, date: '2027-07-16', time: '19:00', partySize: 2, contactName: 'Pat Example' }, rung: 'deep-link', canCommit: false, nextStep: 'open_reservation_link' });
    expect(prep.value.confirmation).toBeUndefined(); // no API rung: nothing to confirm here
    const db = await getDb();
    const rec = (await db.select().from(externalActionRecords)).find((x) => x.kind === 'reservation_prepare');
    expect(rec).toMatchObject({ status: 'prepared', provider: 'resy', targetId: 'test-resy' });
    expect(JSON.stringify(rec)).not.toContain('Pat Example');
    expect(JSON.stringify(await listAuditEvents(db, { requestId: 'req-res-prep' }))).not.toContain('Pat Example');
    const unavailable = await run(prepareReservation, guest, { venueId: 'tampered-venue', date: '2027-07-16', time: '19:00', partySize: 2, contactName: 'Pat' });
    expect(unavailable.ok && unavailable.value.data).toMatchObject({ rung: 'unavailable', nextStep: 'ask_us' });
    expect((await run(prepareReservation, guest, { venueId: 'test-resy', date: '2027-07-16', time: '7pm', partySize: 2, contactName: 'Pat' })).ok).toBe(false);
  });

  it('exposes the external action log to admins with audit access only', async () => {
    const r = await run(adminListExternalActions, admin, {});
    // 3 gift opens (placeholder, ai surface, knot), 1 reservation link (resy), 2 preparations (resy, unavailable tampered venue).
    expect(r.ok && r.value.data.records.map((x) => x.kind).sort()).toEqual(['gift_link', 'gift_link', 'gift_link', 'reservation_link', 'reservation_prepare', 'reservation_prepare']);
    expect(r.ok && r.value.data.records.filter((x) => x.kind === 'reservation_prepare').map((x) => x.provider).sort()).toEqual(['none', 'resy']);
    expect(JSON.stringify(r)).not.toMatch(/seats=|Pat Example/);
    const filtered = await run(adminListExternalActions, admin, { kind: 'reservation_link' });
    expect(filtered.ok && filtered.value.data.records).toHaveLength(1);
    expect((await run(adminListExternalActions, guest, {})).ok).toBe(false);
    expect((await run(adminListExternalActions, { ...admin, entitlements: new Set(['admin_content']) }, {})).ok).toBe(false);
  });
});
