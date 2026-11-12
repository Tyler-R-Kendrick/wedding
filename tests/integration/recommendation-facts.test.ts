import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { findAdventures, saveContentRecord } from '@/capabilities/content';
import { getContentRecordCapability } from '@/capabilities/get_content_record';
import { loadContentSeed, type ContentSeed, type RecommendationSeed } from '@/content';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { getDb, type Db } from '@/db/client';
import { knowledgeRecords, recommendations } from '@/db/schema';
import { seedContent } from '@/db/seed/content';
import { seedId } from '@/db/seed/sources';

/**
 * A recommendation's guest-facing facts (price, hours, booking, diet options, the way in, setting,
 * ages, and where they were checked) from the seed to the database, through /admin/content, and
 * out to a guest's card.
 */
const RECOMMENDATION_ID_BASE = 500;
const FACT_COLUMNS = ['priceLevel', 'hours', 'hoursNote', 'reservations', 'diets', 'stepFree', 'setting', 'minAge', 'factSources', 'factsCheckedAt'] as const;
type Facts = Pick<RecommendationSeed, (typeof FACT_COLUMNS)[number]>;

const RESEARCHED: Facts = {
  priceLevel: 2, hours: 'Mo-Th 07:00-18:00; Fr,Sa 07:00-20:00; Su off', hoursNote: 'Shorter hours in winter.', reservations: 'recommended', diets: ['vegetarian', 'vegan'],
  stepFree: true, setting: 'indoors', minAge: 21, factSources: ['https://www.example.com/visit', 'https://www.example.com/menu'], factsCheckedAt: '2026-11-10',
};
const UNKNOWN = { priceLevel: null, hours: null, hoursNote: null, reservations: null, diets: [], stepFree: null, setting: null, minAge: null, factSources: [], factsCheckedAt: null };

const guest: GuestPrincipal = { kind: 'guest', authIdentityId: 'a' as never, guestId: 'g1' as never, householdId: 'h1' as never, actsFor: ['g1' as never], entitlements: new Set(['view_event']), authenticatedAt: new Date().toISOString(), sessionId: 's1' };
const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'a' as never, adminId: 'adm1' as never, roles: new Set(['owner']), entitlements: new Set(['admin_content']), authenticatedAt: new Date().toISOString(), sessionId: 's2' };
const ctxFor = (principal: Principal, write = false) => createCapabilityContext({ principal, requestId: `req-${newId()}`, surface: 'ui', idempotencyKey: write ? newId() : undefined });

const factsOf = (row: typeof recommendations.$inferSelect) => Object.fromEntries(FACT_COLUMNS.map((c) => [c, row[c]]));
const rowOf = async (db: Db, id: string) => (await db.select().from(recommendations).where(eq(recommendations.id, id)))[0]!;

describe('seeding a recommendation’s facts', () => {
  it('writes them to an untouched row, and into a row the couple edited only where it holds none', async () => {
    const db = await getDb();
    const seed: ContentSeed = structuredClone(loadContentSeed());
    // Three recommendations other tests leave alone, by where the seed puts them.
    const picks = seed.recommendations.map((r, i) => ({ r, id: seedId<string>(RECOMMENDATION_ID_BASE + i) })).filter((p) => p.r.slug !== 'alinea').slice(0, 3);
    const [untouched, edited, unresearched] = picks as [typeof picks[number], typeof picks[number], typeof picks[number]];
    Object.assign(untouched.r, RESEARCHED);
    Object.assign(edited.r, RESEARCHED);

    // The couple has been in /admin/content: one place got its own title, hours, diets and a "No"
    // for the step-free way in; another got a price and nothing else.
    const editedAt = new Date('2026-10-01T12:00:00Z');
    const theirs = { hours: 'Mo-Su 10:00-22:00', diets: ['kosher'], stepFree: false };
    await db.update(recommendations).set({ title: 'As we call it', ...theirs, contentVersion: 3, editedBy: 'admin:adm1', updatedAt: editedAt }).where(eq(recommendations.id, edited.id));
    await db.update(recommendations).set({ priceLevel: 4, contentVersion: 2, editedBy: 'admin:adm1', updatedAt: editedAt }).where(eq(recommendations.id, unresearched.id));

    // As a deploy runs it: inside one transaction (syncContent).
    const deployedAt = new Date('2026-11-12T00:00:00Z');
    await db.transaction(async (tx) => seedContent(tx as unknown as Db, deployedAt, seed));

    // A row nobody edited is the seed's, facts and all.
    expect(factsOf(await rowOf(db, untouched.id))).toEqual(RESEARCHED);
    expect((await rowOf(db, untouched.id)).contentVersion).toBe(1);

    // The edited row keeps every value the couple set (a "No" included) and gains the rest.
    const row = await rowOf(db, edited.id);
    expect(factsOf(row)).toEqual({ ...RESEARCHED, ...theirs });
    expect(row.title).toBe('As we call it');
    // Filling is not an edit: the version, the editor and the time of their edit stand.
    expect(row).toMatchObject({ contentVersion: 3, editedBy: 'admin:adm1', updatedAt: editedAt });

    // An edited row the seed has no facts for is left exactly as it was.
    expect(factsOf(await rowOf(db, unresearched.id))).toEqual({ ...UNKNOWN, priceLevel: 4 });

    // The concierge's corpus says the facts in the page's words, the couple's hours and not the seed's.
    const [knowledge] = await db.select().from(knowledgeRecords).where(eq(knowledgeRecords.id, `recommendations:${edited.id}`));
    expect(knowledge?.content).toContain('Price: Moderate, $15 to $40 each.');
    expect(knowledge?.content).toContain('Hours: Every day: 10 am to 10 pm.');
    expect(knowledge?.content).toContain('Step-free way in: No step-free way in.');
    expect(knowledge?.content).toContain('Shorter hours in winter.');
    expect(knowledge?.content).not.toContain('7 am');

    // A second deploy with nothing new changes nothing.
    const before = await Promise.all(picks.map((p) => rowOf(db, p.id)));
    await seedContent(db, deployedAt, seed);
    expect(await Promise.all(picks.map((p) => rowOf(db, p.id)))).toEqual(before);

    // The research is redone: an untouched row follows the seed, an edited row keeps what it holds,
    // whether the couple typed it or an earlier deploy filled it in.
    const redone: Facts = { ...RESEARCHED, priceLevel: 3, hours: '24/7', diets: ['halal'], stepFree: false, minAge: 18, factSources: ['https://www.example.com/new'], factsCheckedAt: '2026-12-01' };
    Object.assign(untouched.r, redone);
    Object.assign(edited.r, redone);
    Object.assign(unresearched.r, { reservations: 'tickets', diets: ['vegan'] });
    await seedContent(db, new Date('2026-12-02T00:00:00Z'), seed);
    expect(factsOf(await rowOf(db, untouched.id))).toEqual(redone);
    expect(factsOf(await rowOf(db, edited.id))).toEqual({ ...RESEARCHED, ...theirs });
    expect(factsOf(await rowOf(db, unresearched.id))).toEqual({ ...UNKNOWN, priceLevel: 4, reservations: 'tickets', diets: ['vegan'] });
    expect((await rowOf(db, edited.id)).updatedAt).toEqual(editedAt);

    // And a fact the seed drops is not taken away from a row that holds it.
    for (const c of FACT_COLUMNS) delete (edited.r as Record<string, unknown>)[c];
    Object.assign(edited.r, { diets: [], factSources: [] });
    await seedContent(db, new Date('2026-12-03T00:00:00Z'), seed);
    expect(factsOf(await rowOf(db, edited.id))).toEqual({ ...RESEARCHED, ...theirs });
  });
});

describe('editing a recommendation’s facts in /admin/content', () => {
  const load = async (id: string) => {
    const r = await invoke(getContentRecordCapability, await ctxFor(admin), { table: 'recommendations', id });
    if (!r.ok) throw new Error(r.error.message);
    return r.value.data;
  };
  const card = async (slug: string) => {
    const r = await invoke(findAdventures, await ctxFor(guest), { slug });
    if (!r.ok) throw new Error(r.error.message);
    return r.value.data.items[0]!;
  };

  it('saves them, reads them back for the couple, and shows a guest only the facts that are set', async () => {
    const db = await getDb();
    const [{ id }] = (await db.select({ id: recommendations.id }).from(recommendations).where(eq(recommendations.slug, 'alinea'))) as [{ id: string }];
    const before = await load(id);
    // Nothing researched yet: the record holds no facts and the guest's card says none.
    expect(before.values).toMatchObject(UNKNOWN);
    expect('facts' in (await card('alinea'))).toBe(false);

    const typed = {
      priceLevel: 4, hours: 'We-Su 17:00-22:00', hoursNote: 'Closed on some holidays.', reservations: 'required', diets: ['vegetarian', 'gluten-free'],
      stepFree: false, setting: 'indoors', minAge: 12, factSources: ['https://www.example.com/reservations'], factsCheckedAt: '2026-11-11',
    };
    const saved = await invoke(saveContentRecord, await ctxFor(admin, true), { table: 'recommendations', id, data: { ...before.values, ...typed } });
    expect(saved.ok && saved.value.data).toMatchObject({ id, created: false, contentVersion: before.contentVersion + 1 });

    // The couple's view of the record has all of it, where it was checked included.
    const after = await load(id);
    expect(after.values).toMatchObject(typed);
    expect(after.values).toEqual({ ...before.values, ...typed });
    expect(factsOf(await rowOf(db, id))).toEqual(typed);

    // The guest's card carries the facts, and not the research trail behind them.
    const shown = await card('alinea');
    expect(shown.facts).toEqual({
      priceLevel: 4, hours: 'We-Su 17:00-22:00', hoursNote: 'Closed on some holidays.', reservations: 'required', diets: ['vegetarian', 'gluten-free'], stepFree: false, setting: 'indoors', minAge: 12,
    });
    expect(JSON.stringify(shown)).not.toContain('example.com/reservations');
    expect(shown).not.toHaveProperty('factSources');
    expect(shown).not.toHaveProperty('factsCheckedAt');

    // A deploy does not undo any of it.
    await seedContent(db);
    expect(factsOf(await rowOf(db, id))).toEqual(typed);

    // Hours the site could not read back are turned away with how to write them, and nothing is saved.
    const bad = await invoke(saveContentRecord, await ctxFor(admin, true), { table: 'recommendations', id, data: { ...after.values, hours: 'Dinner only' } });
    expect(!bad.ok && bad.error.details?.issues).toEqual([{ path: 'hours', message: 'Write the hours like this: Mo-Th 07:00-18:00; Fr,Sa 07:00-20:00; Su off' }]);
    expect((await rowOf(db, id)).hours).toBe('We-Su 17:00-22:00');

    // One fact changed by itself: the rest stay, and an emptied list is stored as no items.
    const one = await invoke(saveContentRecord, await ctxFor(admin, true), { table: 'recommendations', id, data: { stepFree: null, diets: null }, merge: true });
    expect(one.ok).toBe(true);
    expect(factsOf(await rowOf(db, id))).toEqual({ ...typed, stepFree: null, diets: [] });
    const fewer = await card('alinea');
    expect(fewer.facts).toEqual({ priceLevel: 4, hours: 'We-Su 17:00-22:00', hoursNote: 'Closed on some holidays.', reservations: 'required', setting: 'indoors', minAge: 12 });

    // Cleared again, the card says nothing about them at all.
    const cleared = await invoke(saveContentRecord, await ctxFor(admin, true), { table: 'recommendations', id, data: { ...after.values, ...UNKNOWN } });
    expect(cleared.ok).toBe(true);
    expect((await load(id)).values).toMatchObject(UNKNOWN);
    expect('facts' in (await card('alinea'))).toBe(false);
  });

  it('keeps a hours note that is still a TODO off the guest’s card', async () => {
    const db = await getDb();
    const [{ id }] = (await db.select({ id: recommendations.id }).from(recommendations).where(eq(recommendations.slug, 'alinea'))) as [{ id: string }];
    await db.update(recommendations).set({ hours: 'Mo-Fr 09:00-17:00', hoursNote: 'TODO(Tyler & Sara): holiday hours.' }).where(eq(recommendations.id, id));
    expect((await card('alinea')).facts).toEqual({ hours: 'Mo-Fr 09:00-17:00' });
    await db.update(recommendations).set({ hours: null, hoursNote: null }).where(eq(recommendations.id, id));
  });
});
