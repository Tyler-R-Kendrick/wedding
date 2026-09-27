import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { adminListContentSources, listContentRecordsCapability, saveContentRecord } from '@/capabilities/content';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { faqEntries, operationalFields } from '@/db/schema';
import { SEED_SOURCES } from '@/db/seed/sources';
import { slugify } from '@/domain/content/admin';

/*
 * The content flow never asks the admin for a slug or a list position (the 2026-09-27 admin
 * review, blocker 4). `saveContentRecord` fills them in: a slug from the title, unique in its
 * table, and a new record at the end of the list; an edit that leaves them empty keeps them.
 */

const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'a' as never, adminId: 'adm1' as never, roles: new Set(['owner']), entitlements: new Set(['admin_content']), authenticatedAt: new Date().toISOString(), sessionId: 's2' };
const ctx = () => createCapabilityContext({ principal: admin, requestId: `req-${newId()}`, surface: 'ui', idempotencyKey: newId() });
const mediaOnly: AdminPrincipal = { ...admin, adminId: 'adm2' as never, entitlements: new Set(['admin_media']), sessionId: 's3' };

const faq = (question: string) => ({
  slug: null, order: null, category: 'basics', question, answer: 'An answer.', route: null,
  sourceId: '01SEED00000000000000000101', sourceType: 'authored', sourceUrl: null, verifiedAt: '2026-09-05T00:00:00.000Z', validFrom: null, validUntil: null,
  trustClass: 'TRUSTED_WEDDING', visibility: 'private-draft', placeholder: false,
});

describe('derived content fields', () => {
  it('slugify makes a web address name from a title', () => {
    expect(slugify('Cindy’s Rooftop: café hours!')).toBe('cindys-rooftop-cafe-hours');
    expect(slugify('   ')).toBe('');
  });

  it('a new record gets a unique slug from its title and the next position; an edit keeps both', async () => {
    const db = await getDb();
    const before = await db.select({ order: faqEntries.order }).from(faqEntries);
    const last = Math.max(0, ...before.map((r) => r.order));

    const first = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', data: faq('Is there a shuttle from the hotel?') });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', data: faq('Is there a shuttle from the hotel?') });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const [a] = await db.select().from(faqEntries).where(eq(faqEntries.id, first.value.data.id));
    const [b] = await db.select().from(faqEntries).where(eq(faqEntries.id, second.value.data.id));
    expect(a).toMatchObject({ slug: 'is-there-a-shuttle-from-the-hotel', order: last + 1 });
    expect(b).toMatchObject({ slug: 'is-there-a-shuttle-from-the-hotel-2', order: last + 2 });

    const edited = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', id: a!.id, data: { ...faq('Is there a shuttle back, too?') } });
    expect(edited.ok).toBe(true);
    const [after] = await db.select().from(faqEntries).where(eq(faqEntries.id, a!.id));
    expect(after).toMatchObject({ question: 'Is there a shuttle back, too?', slug: 'is-there-a-shuttle-from-the-hotel', order: last + 1 });
  });

  it('keeps a slug the admin typed', async () => {
    const r = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', data: { ...faq('Where do we park?'), slug: 'valet-and-parking' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await (await getDb()).select().from(faqEntries).where(eq(faqEntries.id, r.value.data.id));
    expect(row!.slug).toBe('valet-and-parking');
  });

  it('moves a record by its position alone: a merge save keeps every other field and a version', async () => {
    const db = await getDb();
    const a = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', data: faq('Can we bring the kids?') });
    const b = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', data: faq('Is there a coat check?') });
    if (!a.ok || !b.ok) throw new Error('setup failed');
    const [ra] = await db.select().from(faqEntries).where(eq(faqEntries.id, a.value.data.id));
    const [rb] = await db.select().from(faqEntries).where(eq(faqEntries.id, b.value.data.id));

    // What Up and Down send (`moveCalls` in the kit): each record's new place, nothing else.
    const up = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', id: rb!.id, data: { order: ra!.order }, merge: true });
    const down = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', id: ra!.id, data: { order: rb!.order }, merge: true });
    expect(up.ok && down.ok).toBe(true);
    const [aa] = await db.select().from(faqEntries).where(eq(faqEntries.id, ra!.id));
    const [bb] = await db.select().from(faqEntries).where(eq(faqEntries.id, rb!.id));
    expect(aa).toMatchObject({ order: rb!.order, question: 'Can we bring the kids?', slug: ra!.slug, contentVersion: 2 });
    expect(bb).toMatchObject({ order: ra!.order, question: 'Is there a coat check?', slug: rb!.slug, contentVersion: 2 });

    // The list says each record's place and web address name, so the page can build the moves.
    const list = await invoke(listContentRecordsCapability, await ctx(), { table: 'faq_entries' });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.data.tables[0]!.records.find((r) => r.id === ra!.id)).toMatchObject({ position: rb!.order, key: ra!.slug });

    // A merge still validates the whole record, and only ever edits one that exists.
    const bad = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', id: ra!.id, data: { category: 'not-a-topic' }, merge: true });
    expect(bad.ok).toBe(false);
    const create = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', data: { order: 1 }, merge: true });
    expect(create.ok).toBe(false);
  });

  it('lists operational fields by key, for the recommendation that shows their hours', async () => {
    const db = await getDb();
    const keys = (await db.select({ key: operationalFields.key }).from(operationalFields)).map((r) => r.key);
    const list = await invoke(listContentRecordsCapability, await ctx(), { table: 'operational_fields' });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.data.tables[0]!.records.map((r) => r.key).sort()).toEqual([...keys].sort());
  });
});

describe('admin_list_content_sources', () => {
  it('returns the registered sources the seed wrote, for admins with content access only', async () => {
    const r = await invoke(adminListContentSources, await ctx(), {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.value.data.sources.map((s) => s.id);
    for (const seeded of SEED_SOURCES) expect(ids).toContain(seeded.id);
    const brief = r.value.data.sources.find((s) => s.id === SEED_SOURCES[0]!.id);
    expect(brief).toMatchObject({ title: SEED_SOURCES[0]!.title, sourceType: SEED_SOURCES[0]!.sourceType, trustClass: SEED_SOURCES[0]!.trustClass, verifiedAt: SEED_SOURCES[0]!.verifiedAt });

    const denied = await invoke(adminListContentSources, await createCapabilityContext({ principal: mediaOnly, requestId: `req-${newId()}`, surface: 'ui' }), {});
    expect(denied.ok).toBe(false);
    const ai = await invoke(adminListContentSources, await createCapabilityContext({ principal: admin, requestId: `req-${newId()}`, surface: 'ai' }), {});
    expect(ai.ok).toBe(false);
  });
});
