import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { SourceType, TrustClass } from '@/contracts/provenance';
import type { ContentVisibility } from './content';

export const KNOWLEDGE_KINDS = ['story', 'adventure', 'recommendation', 'itinerary', 'venue-space', 'venue-fact', 'operational', 'faq'] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/**
 * The AI retrieval corpus (ADR-0003 rule 2, ADR-0011). One row per retrievable chunk,
 * projected from the content tables by `projectKnowledge`. Never authored directly: fix the
 * content record and re-project. Visibility scope is enforced by the search capability with
 * the caller's principal; `private-draft` rows are never returned to guests or to the AI.
 */
export const knowledgeRecords = pgTable(
  'knowledge_records',
  {
    /** "<table>:<recordId>" so re-projection is an upsert. */
    id: text('id').primaryKey(),
    kind: text('kind').$type<KnowledgeKind>().notNull(),
    /** Internal route the citation links to (e.g. "/explore-caa#history"). */
    route: text('route').notNull(),
    title: text('title').notNull(),
    /** Plain text, already flattened; placeholders are excluded (a TODO is not knowledge). */
    content: text('content').notNull(),
    sourceId: text('source_id').notNull(),
    sourceType: text('source_type').$type<SourceType>().notNull(),
    sourceUrl: text('source_url'),
    visibility: text('visibility').$type<ContentVisibility>().notNull(),
    /** Reserved for per-guest facts (a guest's own table, RSVP). Null means "everyone in scope". */
    guestScope: text('guest_scope'),
    /** Reserved for per-event facts. */
    eventScope: text('event_scope'),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }).notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }),
    validUntil: timestamp('valid_until', { withTimezone: true, mode: 'date' }),
    trustClass: text('trust_class').$type<TrustClass>().notNull(),
    contentVersion: integer('content_version').notNull().default(1),
    recordRef: jsonb('record_ref').$type<{ type: string; id: string }>().notNull(),
    /** Lower-cased search terms (title + content), for the static keyword search. */
    terms: jsonb('terms').$type<string[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('knowledge_records_visibility_idx').on(t.visibility), index('knowledge_records_kind_idx').on(t.kind), index('knowledge_records_route_idx').on(t.route)],
);

export type KnowledgeRecordRow = typeof knowledgeRecords.$inferSelect;
export type KnowledgeRecordInsert = typeof knowledgeRecords.$inferInsert;
