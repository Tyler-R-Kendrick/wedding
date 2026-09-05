import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { findAdventures, getStory, getVenueFacts, listAdventures, listItineraries, markContentVerified, saveContentRecord, searchWeddingInformationStatic, showAdventure, showVenueRoom } from '@/capabilities/content';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal, Entitlement, GuestPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { CONTENT_TABLES, PROVENANCE_COLUMN_NAMES, contentRevisions, knowledgeRecords } from '@/db/schema';
import { seedContent } from '@/db/seed/content';
import { listAuditEvents } from '@/lib/audit';
import { eq } from 'drizzle-orm';

const anonymous: Principal = { kind: 'anonymous' };
const guest: GuestPrincipal = { kind: 'guest', authIdentityId: 'a' as never, guestId: 'g1' as never, householdId: 'h1' as never, actsFor: ['g1' as never], entitlements: new Set(['view_event']), authenticatedAt: new Date().toISOString(), sessionId: 's1' };
const admin = (entitlements: Entitlement[] = ['admin_content']): AdminPrincipal => ({ kind: 'admin', authIdentityId: 'a' as never, adminId: 'adm1' as never, roles: new Set(['owner']), entitlements: new Set(entitlements), authenticatedAt: new Date().toISOString(), sessionId: 's2' });

const ctxFor = (principal: Principal, surface: 'ui' | 'ai' | 'webmcp' = 'ui', extra: { idempotencyKey?: string; requestId?: string } = {}) =>
  createCapabilityContext({ principal, requestId: extra.requestId ?? `req-${newId()}`, surface, idempotencyKey: extra.idempotencyKey });

describe('content schema', () => {
  it('every content table carries the ADR-0011 provenance columns', async () => {
    const db = await getDb();
    for (const table of Object.keys(CONTENT_TABLES)) {
      const result = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`);
      const rows = (Array.isArray(result) ? result : (result as { rows: { column_name: string }[] }).rows) as { column_name: string }[];
      const names = rows.map((r) => r.column_name);
      for (const c of PROVENANCE_COLUMN_NAMES) expect(names, `${table}.${c}`).toContain(c);
    }
  });
});

describe('story + adventures visibility', () => {
  it('get_story returns seven chapters with public-route citations', async () => {
    const r = await invoke(getStory, await ctxFor(anonymous, 'ai'), {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.sections.map((s) => s.chapter)).toEqual(['met', 'connection', 'relationship', 'love', 'future', 'engagement', 'marriage']);
    const met = r.value.data.sections[0]!;
    expect(met.paragraphs[0]).toEqual({ text: "We met at Allison and Jamie's wedding.", placeholder: false });
    expect(met.paragraphs.some((p) => p.placeholder)).toBe(true);
    for (const s of r.value.sources) {
      expect(s.url).toMatch(/^\/our-story#/);
      expect(s.url).not.toMatch(/^\/docs\//);
    }
  });

  it('private-draft memories never leak to anonymous, guests, or the AI surface (even for admins)', async () => {
    const forAnon = await invoke(listAdventures, await ctxFor(anonymous), {});
    const forGuest = await invoke(listAdventures, await ctxFor(guest), {});
    const forAdminAi = await invoke(listAdventures, await ctxFor(admin(), 'ai'), {});
    const forAdminMcp = await invoke(listAdventures, await ctxFor(admin(), 'webmcp'), {});
    const forAdminUi = await invoke(listAdventures, await ctxFor(admin()), {});
    const forAdminNoEnt = await invoke(listAdventures, await ctxFor(admin(['admin_audit'])), {});
    for (const r of [forAnon, forGuest, forAdminAi, forAdminMcp, forAdminNoEnt]) {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.data.items.map((i) => i.slug)).toEqual(['starved-rock']);
      expect(r.value.data.total).toBe(1);
    }
    expect(forAdminUi.ok && forAdminUi.value.data.items.length).toBe(8);
    expect(forAdminUi.ok && forAdminUi.value.data.items.every((i) => i.placeholder)).toBe(true);
  });

  it('show_adventure hides drafts as not_found and exposes Starved Rock without an invented trail or date', async () => {
    const hidden = await invoke(showAdventure, await ctxFor(guest), { slug: 'museum-of-ice-cream' });
    expect(!hidden.ok && hidden.error.code).toBe('not_found');
    const adminSees = await invoke(showAdventure, await ctxFor(admin()), { slug: 'museum-of-ice-cream' });
    expect(adminSees.ok).toBe(true);
    const r = await invoke(showAdventure, await ctxFor(anonymous, 'ai'), { slug: 'starved-rock' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.value.data;
    expect(d.summary.text).toContain('I love you');
    expect(d.dateLabel).toBeUndefined();
    expect(d.memory.every((m) => m.placeholder)).toBe(true);
    expect(d.saraMemory?.placeholder).toBe(true);
    expect(d.place?.name).toBe('Starved Rock State Park');
    expect(d.related.map((x) => x.slug)).toEqual(['starved-rock-state-park']);
    const rec = d.related[0]!;
    expect(rec.why?.experienceSlug).toBe('starved-rock');
    expect(rec.handoffs.directions?.url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//);
    expect(rec.handoffs.directions?.label).toContain('Google Maps');
    expect(r.value.sources.map((s) => s.url)).toContain('/our-adventures/starved-rock');
    expect(r.value.sources.map((s) => s.url)).toContain('https://dnr.illinois.gov/parks/park.starvedrock.html');
  });
});

describe('share an adventure', () => {
  it('the why-we-share layer follows the memory\'s visibility', async () => {
    const anon = await invoke(findAdventures, await ctxFor(anonymous), { slug: 'museum-of-ice-cream' });
    expect(anon.ok && anon.value.data.items[0]!.why).toBeUndefined();
    const adm = await invoke(findAdventures, await ctxFor(admin()), { slug: 'museum-of-ice-cream' });
    expect(adm.ok && adm.value.data.items[0]!.why?.experienceSlug).toBe('museum-of-ice-cream');
    const ai = await invoke(findAdventures, await ctxFor(admin(), 'ai'), { slug: 'museum-of-ice-cream' });
    expect(ai.ok && ai.value.data.items[0]!.why).toBeUndefined();
    const starved = await invoke(findAdventures, await ctxFor(anonymous, 'ai'), { slug: 'starved-rock-state-park' });
    expect(starved.ok && starved.value.data.items[0]!.why?.text.text).toContain('I love you');
  });

  it('filters and composes a plan inside a time budget; drafts stay labelled', async () => {
    const r = await invoke(findAdventures, await ctxFor(anonymous), { interests: ['architecture', 'walk'], maxMinutes: 60 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.plan?.totalMinutes).toBeLessThanOrEqual(60);
    expect(r.value.data.plan?.stops[0]?.recommendation.slug).toBe('caa-self-guided-tour');
    expect(r.value.data.items.every((i) => i.draft)).toBe(true);
    const inside = await invoke(findAdventures, await ctxFor(anonymous), { insideCaa: true });
    expect(inside.ok && inside.value.data.items.every((i) => i.interests.includes('inside-caa'))).toBe(true);
    const cindys = inside.ok ? inside.value.data.items.find((i) => i.slug === 'cindys-rooftop') : undefined;
    expect(cindys?.operational?.url).toBe('https://www.chicagoathletichotel.com/restaurants/cindys/');
    expect(cindys?.operational?.provenance.freshness).toBe('fresh');
    expect(cindys?.handoffs.official?.url).toBe('https://www.chicagoathletichotel.com/restaurants/cindys/');
    const kids = await invoke(findAdventures, await ctxFor(anonymous), { kids: true, maxMinutes: 120 });
    expect(kids.ok && kids.value.data.plan?.stops.every((s) => s.recommendation.kidFriendly !== false)).toBe(true);
    const ai = await invoke(findAdventures, await ctxFor(anonymous, 'ai'), {});
    expect(ai.ok && ai.value.data.items.length).toBeLessThanOrEqual(12);
  });

  it('lists the eight itinerary buckets as drafts with resolved stops', async () => {
    const r = await invoke(listItineraries, await ctxFor(anonymous, 'ai'), {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.itineraries.map((i) => i.bucket)).toEqual(['45-min', '2-3-h', 'friday-afternoon', 'saturday-morning', 'with-kids', 'architecture', 'food-drink', 'stay-inside-caa']);
    const short = r.value.data.itineraries[0]!;
    expect(short.stops.map((s) => s.recommendation.slug)).toEqual(['caa-self-guided-tour', 'millennium-park-walk']);
    expect(short.totalMinutes).toBe(45);
    expect(r.value.data.itineraries.every((i) => i.draft)).toBe(true);
    const friday = r.value.data.itineraries.find((i) => i.bucket === 'friday-afternoon')!;
    expect(friday.placeholder).toBe(true);
    expect(friday.intro?.placeholder).toBe(true);
  });
});

describe('CAA docent', () => {
  it('cites history, marks kit capacities, hides closed outlets from guests, and shows them expired to admins', async () => {
    const r = await invoke(getVenueFacts, await ctxFor(anonymous, 'ai'), {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.value.data;
    expect(d.history.map((h) => h.statement)).toContain('Built in 1893 for the private Chicago Athletic Association.');
    expect(d.history.find((h) => h.slug === 'historic-district')!.statement).not.toMatch(/\d{4}/);
    expect(d.spaces.map((s) => s.slug)).toEqual(['white-city-ballroom', 'madison-ballroom', 'stagg-court', 'the-tank']);
    expect(d.spaces[0]!.capacities).toMatchObject({ ceremony: 220, reception: 300, note: expect.stringContaining('Kit figure') });
    expect(d.roomsNotConfirmed.placeholder).toBe(true);
    const outletLabels = d.outlets.map((o) => o.label);
    expect(outletLabels).toContain("Cindy's (rooftop)");
    expect(outletLabels).not.toContain('Milk Room');
    expect(outletLabels).not.toContain('Cherry Circle Room');
    for (const o of d.outlets) {
      expect(o.provenance.verifiedAt).toBeTruthy();
      expect(o.provenance.external).toBe(true);
    }
    const valet = d.gettingHere.find((g) => g.key === 'valet.entrance')!;
    expect(valet.value).toBe('71 E Madison');
    expect(valet.provenance.url).toBe('https://www.chicagoathletichotel.com/about/faq/');
    const rate = d.gettingHere.find((g) => g.key === 'valet.event-rate')!;
    expect(rate.placeholder).toBe(true);
    expect(rate.value).toBeNull();
    expect(r.value.sources.every((s) => !s.url?.startsWith('/docs/'))).toBe(true);

    const ignored = await invoke(getVenueFacts, await ctxFor(guest), { includeExpired: true });
    expect(ignored.ok && ignored.value.data.outlets.map((o) => o.label)).not.toContain('Milk Room');
    const adm = await invoke(getVenueFacts, await ctxFor(admin()), { includeExpired: true });
    expect(adm.ok).toBe(true);
    if (!adm.ok) return;
    const milk = adm.value.data.outlets.find((o) => o.label === 'Milk Room')!;
    expect(milk.expired).toBe(true);
    expect(milk.provenance.freshness).toBe('expired');
  });

  it('show_venue_room returns one space and the rooms-not-confirmed placeholder', async () => {
    const r = await invoke(showVenueRoom, await ctxFor(anonymous), { slug: 'stagg-court' });
    expect(r.ok && r.value.data.space.lookForThis.length).toBeGreaterThan(0);
    expect(r.ok && r.value.data.roomsNotConfirmed.placeholder).toBe(true);
    const missing = await invoke(showVenueRoom, await ctxFor(anonymous), { slug: 'grand-ballroom' });
    expect(!missing.ok && missing.error.code).toBe('not_found');
  });
});

describe('static search', () => {
  it('finds operational records with routes and never returns drafts or placeholder text', async () => {
    const r = await invoke(searchWeddingInformationStatic, await ctxFor(anonymous, 'ai'), { query: 'valet parking' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.results[0]!.route).toBe('/explore-caa#getting-here');
    expect(r.value.sources[0]!.url).toMatch(/^https:\/\/www\.chicagoathletichotel\.com\//);
    const drafts = await invoke(searchWeddingInformationStatic, await ctxFor(guest, 'ai'), { query: 'ice cream museum' });
    expect(drafts.ok && drafts.value.data.results.filter((x) => x.kind === 'adventure')).toEqual([]);
    const all = await invoke(searchWeddingInformationStatic, await ctxFor(anonymous, 'ai'), { query: 'wedding', limit: 20 });
    expect(all.ok && all.value.data.results.every((x) => !x.snippet.includes('TODO(Tyler & Sara)'))).toBe(true);
    const nothing = await invoke(searchWeddingInformationStatic, await ctxFor(anonymous, 'ai'), { query: 'zebra crossing' });
    expect(nothing.ok && nothing.value.data.results).toEqual([]);
    // Draft rows are projected (for admin search) but never returned to guests or the AI, whoever asks.
    const db = await getDb();
    const drafted = await db.select().from(knowledgeRecords).where(eq(knowledgeRecords.visibility, 'private-draft'));
    expect(drafted.length).toBeGreaterThan(0);
    const adminAi = await invoke(searchWeddingInformationStatic, await ctxFor(admin(), 'ai'), { query: drafted[0]!.title, limit: 20 });
    expect(adminAi.ok && adminAi.value.data.results.map((x) => x.id)).not.toContain(drafted[0]!.id);
    const adminUi = await invoke(searchWeddingInformationStatic, await ctxFor(admin(), 'ui'), { query: drafted[0]!.title, limit: 20 });
    expect(adminUi.ok && adminUi.value.data.results.map((x) => x.id)).toContain(drafted[0]!.id);
  });
});

describe('admin editors', () => {
  it('save_content_record is admin-only, needs admin_content, and needs an idempotency key', async () => {
    const data = { slug: 'test-fact', order: 99, category: 'history', statement: 'A test fact.', note: null, sourceId: '01SEED00000000000000000101', sourceType: 'authored', sourceUrl: null, verifiedAt: '2026-09-05T00:00:00.000Z', validFrom: null, validUntil: null, trustClass: 'TRUSTED_WEDDING', visibility: 'private-draft', placeholder: false };
    const anon = await invoke(saveContentRecord, await ctxFor(anonymous), { table: 'venue_facts', data });
    expect(!anon.ok && anon.error.code).toBe('unauthenticated');
    const noEnt = await invoke(saveContentRecord, await ctxFor(admin(['admin_audit']), 'ui', { idempotencyKey: newId() }), { table: 'venue_facts', data });
    expect(!noEnt.ok && noEnt.error.code).toBe('forbidden');
    const noKey = await invoke(saveContentRecord, await ctxFor(admin()), { table: 'venue_facts', data });
    expect(!noKey.ok && noKey.error.code).toBe('validation');
    const viaAi = await invoke(saveContentRecord, await ctxFor(admin(), 'ai', { idempotencyKey: newId() }), { table: 'venue_facts', data });
    expect(!viaAi.ok && viaAi.error.code).toBe('not_found'); // not exposed to the concierge
  });

  it('creates, updates with a revision + audit, replays on the same key, and marks verified with content.verified', async () => {
    const db = await getDb();
    const key = newId();
    const data = { slug: 'test-fact-2', order: 98, category: 'history', statement: 'Another test fact.', note: null, sourceId: '01SEED00000000000000000101', sourceType: 'authored', sourceUrl: null, verifiedAt: '2026-01-01T00:00:00.000Z', validFrom: null, validUntil: null, trustClass: 'TRUSTED_WEDDING', visibility: 'private-draft', placeholder: false };
    const created = await invoke(saveContentRecord, await ctxFor(admin(), 'ui', { idempotencyKey: key, requestId: 'req-c-1' }), { table: 'venue_facts', data });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.data).toMatchObject({ contentVersion: 1, created: true });
    const id = created.value.data.id;
    const replay = await invoke(saveContentRecord, await ctxFor(admin(), 'ui', { idempotencyKey: key }), { table: 'venue_facts', data });
    expect(replay.ok && replay.value.data.id).toBe(id);
    const conflict = await invoke(saveContentRecord, await ctxFor(admin(), 'ui', { idempotencyKey: key }), { table: 'venue_facts', data: { ...data, statement: 'changed' } });
    expect(!conflict.ok && conflict.error.code).toBe('conflict');

    const bad = await invoke(saveContentRecord, await ctxFor(admin(), 'ui', { idempotencyKey: newId() }), { table: 'venue_facts', id, data: { ...data, statement: 'TODO(Tyler & Sara): later' } });
    expect(!bad.ok && bad.error.code).toBe('validation');

    const updated = await invoke(saveContentRecord, await ctxFor(admin(), 'ui', { idempotencyKey: newId(), requestId: 'req-c-2' }), { table: 'venue_facts', id, data: { ...data, statement: 'Edited statement.' } });
    expect(updated.ok && updated.value.data).toMatchObject({ id, contentVersion: 2, created: false });
    const revisions = await db.select().from(contentRevisions).where(eq(contentRevisions.recordId, id));
    expect(revisions.map((r) => r.contentVersion)).toEqual([1]);
    expect(revisions[0]!.snapshot).toMatchObject({ statement: 'Another test fact.' });
    expect((await listAuditEvents(db, { action: 'content.updated', targetId: id })).length).toBe(2);

    const verified = await invoke(markContentVerified, await ctxFor(admin(), 'ui', { idempotencyKey: newId(), requestId: 'req-c-3' }), { table: 'venue_facts', id });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.data.previousVerifiedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(Date.parse(verified.value.data.verifiedAt)).toBeGreaterThan(Date.parse('2026-09-01T00:00:00Z'));
    const audits = await listAuditEvents(db, { action: 'content.verified', targetId: id });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ previousVerifiedAt: '2026-01-01T00:00:00.000Z', sourceType: 'authored' });
    expect(audits[0]!.actor).toEqual({ kind: 'admin', adminId: 'adm1' });
    const future = await invoke(markContentVerified, await ctxFor(admin(), 'ui', { idempotencyKey: newId() }), { table: 'venue_facts', id, verifiedAt: '2099-01-01T00:00:00.000Z' });
    expect(!future.ok && future.error.code).toBe('validation');

    // Admin edits survive a reseed (the seed only refreshes untouched version-1 rows).
    await seedContent(db);
    const still = await invoke(getVenueFacts, await ctxFor(admin()), {});
    expect(still.ok && still.value.data.history.find((h) => h.slug === 'test-fact-2')?.statement).toBe('Edited statement.');
    // And the draft stays invisible to guests.
    const guestView = await invoke(getVenueFacts, await ctxFor(guest), {});
    expect(guestView.ok && guestView.value.data.history.find((h) => h.slug === 'test-fact-2')).toBeUndefined();
  });
});
