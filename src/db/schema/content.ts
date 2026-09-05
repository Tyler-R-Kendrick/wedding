import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { SourceType, TrustClass } from '@/contracts/provenance';

/** Provenance registry: every fact the site shows or the AI cites points at one of these rows. */
export const contentSources = pgTable('content_sources', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').$type<SourceType>().notNull(),
  title: text('title').notNull(),
  canonicalUrl: text('canonical_url'),
  documentName: text('document_name'),
  verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }).notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }),
  validUntil: timestamp('valid_until', { withTimezone: true, mode: 'date' }),
  trustClass: text('trust_class').$type<TrustClass>().notNull(),
  contentVersion: integer('content_version').notNull().default(1),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type ContentSourceRow = typeof contentSources.$inferSelect;
