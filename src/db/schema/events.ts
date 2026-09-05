import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';
import { guests } from './guests.stub';

/** Plus-one policy per guest × event. `named`: a name is required; `unnamed`: "and guest" is fine. */
export const PLUS_ONE_POLICIES = ['none', 'named', 'unnamed'] as const;
export type PlusOnePolicy = (typeof PLUS_ONE_POLICIES)[number];

/** RSVP window override. `auto` follows the lifecycle (RSVP_OPEN) and the deadline; manual beats schedule (ADR-0012). */
export const RSVP_WINDOW_MODES = ['auto', 'open', 'closed'] as const;
export type RsvpWindowMode = (typeof RSVP_WINDOW_MODES)[number];

export const NOTICE_SEVERITIES = ['info', 'urgent'] as const;
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

/**
 * Wedding events (ceremony, cocktail hour, reception, …). Times are America/Chicago instants;
 * every unknown fact stays NULL with `placeholder = true` (TODO(Tyler & Sara)), never invented.
 */
export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Calendar day in the wedding time zone (the wedding date is a brief fact; times are not). */
    dateIso: date('date_iso').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    timezone: text('timezone').notNull().default('America/Chicago'),
    /** CAA space slug (white-city-ballroom, madison-ballroom, stagg-court, the-tank) or NULL until confirmed. */
    venueSpaceRef: text('venue_space_ref'),
    dressCode: text('dress_code'),
    accessibilityNote: text('accessibility_note'),
    /** True while room/time/dress code are unconfirmed. Rendered as an explicit placeholder. */
    placeholder: boolean('placeholder').notNull().default(true),
    rsvpRequired: boolean('rsvp_required').notNull().default(true),
    /** Whether a meal choice is collected for this event. */
    hasMeal: boolean('has_meal').notNull().default(false),
    /** Current meal option set version; rows in meal_options with this version are the valid choices. */
    mealOptionsVersion: integer('meal_options_version').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    sourceId: text('source_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('events_slug_idx').on(t.slug)],
);

/** Guest × event invitation scope with the plus-one policy for that pairing. */
export const eventEntitlements = pgTable(
  'event_entitlements',
  {
    id: text('id').primaryKey(),
    guestId: text('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    plusOnePolicy: text('plus_one_policy').$type<PlusOnePolicy>().notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('event_entitlements_guest_event_idx').on(t.guestId, t.eventId), index('event_entitlements_event_idx').on(t.eventId)],
);

/** Versioned meal options. Editing the menu publishes a new version; responses record the version they chose from. */
export const mealOptions = pgTable(
  'meal_options',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('meal_options_event_version_idx').on(t.eventId, t.version)],
);

/** Single row (id = 'current'): open/close/deadline controls. Deadline is TODO(Tyler & Sara) until set. */
export const rsvpSettings = pgTable('rsvp_settings', {
  id: text('id').primaryKey().default('current'),
  mode: text('mode').$type<RsvpWindowMode>().notNull().default('auto'),
  deadlineAt: timestamp('deadline_at', { withTimezone: true, mode: 'date' }),
  note: text('note'),
  updatedBy: jsonb('updated_by').$type<PrincipalRef>(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/** Admin notices shown on Your Weekend (e.g. "the ceremony moved indoors"). */
export const weekendNotices = pgTable(
  'weekend_notices',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    severity: text('severity').$type<NoticeSeverity>().notNull().default('info'),
    active: boolean('active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    createdBy: jsonb('created_by').$type<PrincipalRef>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('weekend_notices_active_idx').on(t.active)],
);

export type EventRow = typeof events.$inferSelect;
export type EventEntitlementRow = typeof eventEntitlements.$inferSelect;
export type MealOptionRow = typeof mealOptions.$inferSelect;
export type RsvpSettingsRow = typeof rsvpSettings.$inferSelect;
export type WeekendNoticeRow = typeof weekendNotices.$inferSelect;
