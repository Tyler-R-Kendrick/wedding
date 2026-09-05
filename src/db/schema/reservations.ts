import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';

/**
 * A reservable place (restaurant, outlet) with whatever handoff the couple/admins have
 * configured. The reservation ladder (ADR-0004) picks the rung per request:
 * api -> provider deep link (Resy/OpenTable) -> admin URL -> honest unavailable.
 * `placeRef` links to the content swarm's `places` row at integration.
 */
export const reservationVenues = pgTable('reservation_venues', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  placeRef: text('place_ref'),
  resySlug: text('resy_slug'),
  openTableId: text('open_table_id'),
  /** Admin-configured booking page; must pass the redirect allowlist. */
  url: text('url'),
  note: text('note'),
  placeholder: boolean('placeholder').notNull().default(true),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  sourceId: text('source_id'),
  verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
  updatedBy: jsonb('updated_by').$type<PrincipalRef>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type ReservationVenueRow = typeof reservationVenues.$inferSelect;
