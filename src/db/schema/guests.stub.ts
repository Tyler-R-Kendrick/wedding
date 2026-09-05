import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * STUB — Swarm D owns `guests` / `households` / `invitations` (src/db/schema/guests.ts).
 * Swarm E only needs the two table names and their `id` columns so that its foreign keys
 * (event_entitlements, rsvp_responses, guest_needs, seat_assignments) resolve in drizzle
 * and in its migration. Columns here are the minimum the RSVP/seating surfaces read
 * (names for display, household for scoping, email for the confirmation outbox, isMinor).
 *
 * INTEGRATOR: at merge, delete this file, re-export D's `guests`/`households` from
 * `src/db/schema/index.ts`, and squash the `CREATE TABLE "guests"/"households"` statements
 * in Swarm E's migration into D's (D's definition wins; E never writes these tables).
 */
export const households = pgTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Guest id of the household manager (no FK to avoid a cycle; D owns the real shape). */
  managerGuestId: text('manager_guest_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const guests = pgTable(
  'guests',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    displayName: text('display_name').notNull(),
    /** Optional; used only as the RSVP confirmation recipient. Never logged. */
    email: text('email'),
    isMinor: boolean('is_minor').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('guests_household_idx').on(t.householdId)],
);

export type GuestRow = typeof guests.$inferSelect;
export type HouseholdRow = typeof households.$inferSelect;
