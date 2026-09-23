import { and, eq, like, notInArray, or, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../client';
import { loadContentSeed, SOURCE_KEYS, type ContentSeed, type ProvenanceSeed } from '@/content';
import { projectKnowledge } from '@/domain/knowledge/projection';
import {
  adventureMemories, faqEntries, itineraryTemplates, operationalFields, places, recommendations, storySections, timelineMoments, venueFacts, venueSpaces,
  type TimelineMomentRow,
} from '../schema';
import { seedId } from './sources';

/** Stable id ranges per table so the seed is idempotent and recognisable in audit rows. */
const ID_BASE = { story: 200, places: 300, adventures: 400, recommendations: 500, itineraries: 600, venueSpaces: 700, venueFacts: 800, operational: 900, faq: 1000, timeline: 1100 } as const;

const toDate = (s: string | undefined) => (s ? new Date(s) : null);

type ContentTable = PgTable & { id: AnyPgColumn; contentVersion: AnyPgColumn };

/** Insert or refresh a seed row. Rows an admin has edited (contentVersion > 1) are never overwritten. */
async function upsertSeedRow<T extends ContentTable>(db: Db, table: T, values: T['$inferInsert']): Promise<void> {
  await db
    .insert(table)
    .values(values as never)
    .onConflictDoUpdate({ target: table.id, set: values as never, setWhere: sql`${table.contentVersion} = 1` });
}

function provenance(p: ProvenanceSeed, now: Date) {
  return {
    sourceId: SOURCE_KEYS[p.sourceKey],
    sourceType: p.sourceType,
    sourceUrl: p.sourceUrl ?? null,
    verifiedAt: new Date(p.verifiedAt),
    validFrom: toDate(p.validFrom),
    validUntil: toDate(p.validUntil),
    trustClass: p.trustClass,
    editedBy: p.editedBy,
    visibility: p.visibility,
    placeholder: p.placeholder,
    updatedAt: now,
  };
}

/**
 * The timeline stations exactly as `db:seed` writes them. Also read directly by the timeline repo
 * when the table has not been migrated yet (a preview deployment reads the production database and
 * never migrates), so the page shows what the seed would, not a 500.
 */
export function timelineSeedRows(seed: ContentSeed, now: Date): TimelineMomentRow[] {
  return seed.timeline.map((t) => ({
    id: timelineSeedId(t.slug), slug: t.slug, chapter: t.chapter, order: t.order, title: t.title, occurredOn: t.occurredOn ?? null, locationLabel: t.locationLabel ?? null,
    note: t.note, media: t.media, adventureSlug: t.adventureSlug ?? null, externalRef: t.externalRef ?? null, ...provenance(t, now), contentVersion: 1, createdAt: now,
  }));
}

/**
 * A station's id follows its slug, never its position in timeline.json: an import that re-dates the
 * line reorders the file, and a positional id would rewrite one stop's row with another stop's slug
 * (tripping the unique slug index, or silently landing on a row an admin edited).
 */
function timelineSeedId(slug: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 0x01000193) >>> 0;
  return seedId(ID_BASE.timeline * 1_000_000_000_000 + h);
}

/**
 * Upserts the timeline by slug and removes the stations the seed no longer has — but only rows the
 * seed or the Paired import wrote and nobody has edited since (contentVersion 1). A station typed in
 * /admin/content, or an edited one, is never touched.
 */
export async function seedTimeline(db: Db, seed: ContentSeed, now: Date): Promise<void> {
  const rows = timelineSeedRows(seed, now);
  for (const row of rows) {
    const { id: _id, createdAt: _createdAt, ...update } = row;
    await db
      .insert(timelineMoments)
      .values(row)
      .onConflictDoUpdate({ target: timelineMoments.slug, set: update, setWhere: sql`${timelineMoments.contentVersion} = 1` });
  }
  const keep = rows.map((r) => r.slug);
  await db
    .delete(timelineMoments)
    .where(
      and(
        eq(timelineMoments.contentVersion, 1),
        or(like(timelineMoments.editedBy, 'seed:%'), eq(timelineMoments.editedBy, 'import:paired')),
        keep.length ? notInArray(timelineMoments.slug, keep) : undefined,
      ),
    );
}

/**
 * Upserts the brief-derived content (src/content/seed/*.json) and re-projects the AI corpus.
 * Idempotent. Seeded rows never overwrite an admin edit: a row whose contentVersion > 1 is left alone.
 */
export async function seedContent(db: Db, now: Date = new Date()): Promise<void> {
  const seed = loadContentSeed();

  const placeIds = new Map(seed.places.map((p, i) => [p.slug, seedId(ID_BASE.places + i)]));
  const adventureIds = new Map(seed.adventures.map((a, i) => [a.slug, seedId(ID_BASE.adventures + i)]));
  const recommendationIds = new Map(seed.recommendations.map((r, i) => [r.slug, seedId(ID_BASE.recommendations + i)]));

  const upsert = <T extends ContentTable>(table: T, values: T['$inferInsert']) => upsertSeedRow(db, table, values);

  for (const [i, s] of seed.story.entries()) {
    await upsert(storySections, { id: seedId(ID_BASE.story + i), slug: s.slug, chapter: s.chapter, order: s.order, title: s.title, paragraphs: s.paragraphs, media: s.media, ...provenance(s, now) });
  }
  await seedTimeline(db, seed, now);
  for (const [i, p] of seed.places.entries()) {
    await upsert(places, {
      id: seedId(ID_BASE.places + i), slug: p.slug, name: p.name, kind: p.kind, address: p.address ?? null, city: p.city ?? null, region: p.region ?? null,
      lat: p.lat ?? null, lng: p.lng ?? null, url: p.url ?? null, resySlug: p.resySlug ?? null, openTableId: p.openTableId ?? null, insideVenue: p.insideVenue, ...provenance(p, now),
    });
  }
  for (const [i, a] of seed.adventures.entries()) {
    await upsert(adventureMemories, {
      id: seedId(ID_BASE.adventures + i), slug: a.slug, title: a.title, dateExact: a.dateExact ?? null, dateApprox: a.dateApprox ?? null, season: a.season ?? null, timeOfDay: a.timeOfDay ?? null,
      placeId: a.placeSlug ? placeIds.get(a.placeSlug)! : null, locationLabel: a.locationLabel ?? null, lat: a.lat ?? null, lng: a.lng ?? null, summary: a.summary, memory: a.memory,
      saraMemory: a.saraMemory ?? null, tylerMemory: a.tylerMemory ?? null, media: a.media, tags: a.tags, durationMinutes: a.durationMinutes ?? null, accessibilityNotes: a.accessibilityNotes ?? null,
      relatedRecommendationIds: a.relatedRecommendationSlugs.map((s) => recommendationIds.get(s)!), ...provenance(a, now),
    });
  }
  for (const [i, r] of seed.recommendations.entries()) {
    await upsert(recommendations, {
      id: seedId(ID_BASE.recommendations + i), slug: r.slug, title: r.title, category: r.category, interests: r.interests, placeId: r.placeSlug ? placeIds.get(r.placeSlug)! : null, what: r.what,
      durationMinutes: r.durationMinutes ?? null, distanceFromCaa: r.distanceFromCaa ?? null, cost: r.cost ?? null, accessibility: r.accessibility ?? null, bookingUrl: r.bookingUrl ?? null,
      operationalKey: r.operationalKey ?? null, experienceId: r.experienceSlug ? adventureIds.get(r.experienceSlug)! : null, whyWeShareThis: r.whyWeShareThis ?? null, kidFriendly: r.kidFriendly ?? null,
      draft: r.draft, ...provenance(r, now),
    });
  }
  for (const [i, it] of seed.itineraries.entries()) {
    await upsert(itineraryTemplates, {
      id: seedId(ID_BASE.itineraries + i), slug: it.slug, title: it.title, bucket: it.bucket, intro: it.intro ?? null, minMinutes: it.minMinutes ?? null, maxMinutes: it.maxMinutes ?? null, interests: it.interests,
      stops: it.stops.map((s) => ({ recommendationId: recommendationIds.get(s.recommendationSlug)!, ...(s.minutes ? { minutes: s.minutes } : {}), ...(s.note ? { note: s.note } : {}) })),
      draft: it.draft, ...provenance(it, now),
    });
  }
  for (const [i, v] of seed.venueSpaces.entries()) {
    await upsert(venueSpaces, { id: seedId(ID_BASE.venueSpaces + i), slug: v.slug, name: v.name, order: v.order, character: v.character, features: v.features, capacities: v.capacities, lookForThis: v.lookForThis, ...provenance(v, now) });
  }
  for (const [i, f] of seed.venueFacts.entries()) {
    await upsert(venueFacts, { id: seedId(ID_BASE.venueFacts + i), slug: f.slug, order: f.order, category: f.category, statement: f.statement, note: f.note ?? null, ...provenance(f, now) });
  }
  for (const [i, o] of seed.operationalFields.entries()) {
    await upsert(operationalFields, { id: seedId(ID_BASE.operational + i), key: o.key, kind: o.kind, label: o.label, value: o.value ?? null, url: o.url ?? null, note: o.note ?? null, order: o.order, ...provenance(o, now) });
  }
  for (const [i, q] of seed.faq.entries()) {
    await upsert(faqEntries, { id: seedId(ID_BASE.faq + i), slug: q.slug, order: q.order, category: q.category, question: q.question, answer: q.answer, route: q.route ?? null, ...provenance(q, now) });
  }

  await projectKnowledge(db, now);
}
