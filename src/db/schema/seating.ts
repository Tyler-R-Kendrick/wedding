import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';
import { guests } from './guests';

/** One anchor per table position on a floor plan (SVG user units within `viewBox`). */
export interface FloorPlanAnchor {
  id: string;
  x: number;
  y: number;
  label: string;
}

/**
 * Floor plan per CAA venue space. The outline is an SVG path in `viewBox` units drawn by the
 * FloorPlan component; anchors are where tables sit. Shipped as placeholders (TODO(Tyler & Sara))
 * until the planner's plans arrive. No raw SVG markup is stored (nothing admin-editable is injected).
 */
export const floorPlans = pgTable(
  'floor_plans',
  {
    id: text('id').primaryKey(),
    venueSpaceRef: text('venue_space_ref').notNull(),
    name: text('name').notNull(),
    viewBox: text('view_box').notNull(),
    outline: text('outline').notNull(),
    anchors: jsonb('anchors').$type<FloorPlanAnchor[]>().notNull(),
    placeholder: boolean('placeholder').notNull().default(true),
    sourceId: text('source_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('floor_plans_space_idx').on(t.venueSpaceRef)],
);

/** Draft tables (the working seating chart). Guests never read this table directly. */
export const seatingTables = pgTable(
  'seating_tables',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    capacity: integer('capacity').notNull().default(10),
    floorPlanId: text('floor_plan_id').references(() => floorPlans.id, { onDelete: 'set null' }),
    anchorId: text('anchor_id'),
    /** Admin-only planning notes; never in guest output. */
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('seating_tables_name_idx').on(t.name)],
);

/** Draft seat assignments: one seat per guest. */
export const seatAssignments = pgTable(
  'seat_assignments',
  {
    id: text('id').primaryKey(),
    tableId: text('table_id')
      .notNull()
      .references(() => seatingTables.id, { onDelete: 'cascade' }),
    guestId: text('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    seatNumber: integer('seat_number'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('seat_assignments_guest_idx').on(t.guestId), index('seat_assignments_table_idx').on(t.tableId)],
);

/** Immutable snapshot of what guests may see. Guest-facing reads use ONLY this, never the draft. */
export interface SeatingSnapshot {
  version: 1;
  tables: Array<{ id: string; name: string; capacity: number; floorPlanId: string | null; anchorId: string | null }>;
  assignments: Array<{ guestId: string; tableId: string; seatNumber: number | null; displayName: string }>;
}

/** Publication history. The latest row with `unpublished_at IS NULL` is the live chart. */
export const seatingPublications = pgTable(
  'seating_publications',
  {
    id: text('id').primaryKey(),
    snapshot: jsonb('snapshot').$type<SeatingSnapshot>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    publishedBy: jsonb('published_by').$type<PrincipalRef>().notNull(),
    unpublishedAt: timestamp('unpublished_at', { withTimezone: true, mode: 'date' }),
    unpublishedBy: jsonb('unpublished_by').$type<PrincipalRef>(),
    note: text('note'),
  },
  (t) => [index('seating_publications_published_at_idx').on(t.publishedAt)],
);

export type FloorPlanRow = typeof floorPlans.$inferSelect;
export type SeatingTableRow = typeof seatingTables.$inferSelect;
export type SeatAssignmentRow = typeof seatAssignments.$inferSelect;
export type SeatingPublicationRow = typeof seatingPublications.$inferSelect;
