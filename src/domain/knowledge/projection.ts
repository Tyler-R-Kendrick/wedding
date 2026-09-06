import { CONTENT_TABLES, type ContentTableName } from '@/db/schema/content';
import type { KnowledgeKind, KnowledgeRecordInsert } from '@/db/schema/knowledge';
import type { Db } from '@/db/client';
import { knowledgeRecords } from '@/db/schema';
import { withoutPlaceholders } from '@/domain/content/text';
import { ROUTES } from '@/domain/routes';

/** Lower-cased word terms for the static keyword search. */
export function toTerms(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const w of t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9']+/)) {
      if (w.length >= 2) out.add(w);
    }
  }
  return [...out];
}

type Rows = { [K in ContentTableName]: (typeof CONTENT_TABLES)[K]['$inferSelect'][] };

/**
 * Builds the retrieval corpus from the content tables. A TODO is not knowledge, so
 * placeholder sentences are dropped and records with nothing left are skipped. Visibility
 * and validity are copied through so the search capability can filter by principal.
 */
export function buildKnowledgeRecords(rows: Rows, now: Date): KnowledgeRecordInsert[] {
  const out: KnowledgeRecordInsert[] = [];
  const push = (kind: KnowledgeKind, table: ContentTableName, row: Rows[ContentTableName][number], title: string, route: string, texts: (string | null | undefined)[]) => {
    const content = withoutPlaceholders(texts).join(' ');
    if (!content) return;
    out.push({
      id: `${table}:${row.id}`,
      kind,
      route,
      title,
      content,
      sourceId: row.sourceId,
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      visibility: row.visibility,
      guestScope: null,
      eventScope: null,
      verifiedAt: row.verifiedAt,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      trustClass: row.trustClass,
      contentVersion: row.contentVersion,
      recordRef: { type: table, id: row.id },
      terms: toTerms(title, content),
      updatedAt: now,
    });
  };

  for (const s of rows.story_sections) push('story', 'story_sections', s, s.title, `${ROUTES.story}#${s.slug}`, s.paragraphs);
  const placeById = new Map(rows.places.map((p) => [p.id, p]));
  for (const a of rows.adventure_memories) {
    const place = a.placeId ? placeById.get(a.placeId) : undefined;
    push('adventure', 'adventure_memories', a, a.title, `${ROUTES.adventures}/${a.slug}`, [a.summary, ...a.memory, a.saraMemory, a.tylerMemory, place && !place.placeholder ? `Place: ${place.name}` : null]);
  }
  for (const r of rows.recommendations) {
    const place = r.placeId ? placeById.get(r.placeId) : undefined;
    push('recommendation', 'recommendations', r, r.title, `${ROUTES.share}/${r.slug}`, [r.what, r.distanceFromCaa, r.cost, r.accessibility, place && !place.placeholder ? `Place: ${place.name}${place.address ? `, ${place.address}` : ''}` : null]);
  }
  for (const i of rows.itinerary_templates) push('itinerary', 'itinerary_templates', i, i.title, `${ROUTES.share}#${i.slug}`, [i.intro]);
  for (const v of rows.venue_spaces) push('venue-space', 'venue_spaces', v, v.name, `${ROUTES.exploreCaa}/${v.slug}`, [v.character, ...v.lookForThis, `Capacities are ${v.capacities.note}`]);
  for (const f of rows.venue_facts) push('venue-fact', 'venue_facts', f, f.statement, `${ROUTES.exploreCaa}#${f.category === 'look-for-this' ? 'look-for-this' : 'history'}`, [f.statement]);
  for (const o of rows.operational_fields) push('operational', 'operational_fields', o, o.label, `${ROUTES.exploreCaa}#${o.kind === 'outlet' || o.kind === 'amenity' ? 'outlets' : 'getting-here'}`, [o.value, o.note]);
  for (const q of rows.faq_entries) push('faq', 'faq_entries', q, q.question, `${ROUTES.ask}#${q.slug}`, [q.answer]);
  return out;
}

/** Re-projects the whole corpus (content is small; a full rebuild keeps it exactly in sync). */
export async function projectKnowledge(db: Db, now: Date = new Date()): Promise<number> {
  const rows: Rows = {
    story_sections: await db.select().from(CONTENT_TABLES.story_sections),
    places: await db.select().from(CONTENT_TABLES.places),
    adventure_memories: await db.select().from(CONTENT_TABLES.adventure_memories),
    recommendations: await db.select().from(CONTENT_TABLES.recommendations),
    itinerary_templates: await db.select().from(CONTENT_TABLES.itinerary_templates),
    venue_spaces: await db.select().from(CONTENT_TABLES.venue_spaces),
    venue_facts: await db.select().from(CONTENT_TABLES.venue_facts),
    operational_fields: await db.select().from(CONTENT_TABLES.operational_fields),
    faq_entries: await db.select().from(CONTENT_TABLES.faq_entries),
  };
  const records = buildKnowledgeRecords(rows, now);
  await db.delete(knowledgeRecords);
  if (records.length) await db.insert(knowledgeRecords).values(records);
  return records.length;
}
