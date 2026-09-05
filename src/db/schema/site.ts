import { date, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { LifecycleState } from '@/contracts/lifecycle';
import type { PrincipalRef } from '@/contracts/principal';

/** Single-row site configuration. Facts come from docs/design/brief.md via the seed. */
export const siteSettings = pgTable('site_settings', {
  id: text('id').primaryKey(),
  coupleDisplayName: text('couple_display_name').notNull(),
  partner1Name: text('partner1_name').notNull(),
  partner2Name: text('partner2_name').notNull(),
  weddingDate: date('wedding_date').notNull(),
  timezone: text('timezone').notNull(),
  venueName: text('venue_name').notNull(),
  venueAddress: text('venue_address').notNull(),
  venueUrl: text('venue_url'),
  /** Theme ids in display order; the design swarm owns their definitions. */
  themes: jsonb('themes').$type<string[]>().notNull(),
  defaultTheme: text('default_theme').notNull(),
  /** content_sources.id backing these facts. */
  sourceId: text('source_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/** Single row (id = 'current'). Manual publish state always beats the wall clock. */
export const lifecycleState = pgTable('lifecycle_state', {
  id: text('id').primaryKey().default('current'),
  state: text('state').$type<LifecycleState>().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  publishedBy: jsonb('published_by').$type<PrincipalRef>().notNull(),
  note: text('note'),
});

export type SiteSettingsRow = typeof siteSettings.$inferSelect;
export type LifecycleRow = typeof lifecycleState.$inferSelect;
