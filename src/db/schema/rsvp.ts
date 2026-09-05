import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';
import { events, mealOptions } from './events';
import { guests, households } from './guests.stub';

export const RSVP_STATUSES = ['accepted', 'declined'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const RSVP_CHANNELS = ['guest', 'admin'] as const;
export type RsvpChannel = (typeof RSVP_CHANNELS)[number];

/** One row per guest × event; absence means "no answer yet". Rewritten in place, `version` increments. */
export const rsvpResponses = pgTable(
  'rsvp_responses',
  {
    id: text('id').primaryKey(),
    guestId: text('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    status: text('status').$type<RsvpStatus>().notNull(),
    mealOptionId: text('meal_option_id').references(() => mealOptions.id, { onDelete: 'set null' }),
    /** The meal option set version the choice was made from; differs from the event's current version when the menu changed. */
    mealOptionsVersion: integer('meal_options_version'),
    plusOneAttending: boolean('plus_one_attending').notNull().default(false),
    plusOneName: text('plus_one_name'),
    plusOneMealOptionId: text('plus_one_meal_option_id').references(() => mealOptions.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    submittedBy: jsonb('submitted_by').$type<PrincipalRef>().notNull(),
    submittedVia: text('submitted_via').$type<RsvpChannel>().notNull().default('guest'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('rsvp_responses_guest_event_idx').on(t.guestId, t.eventId), index('rsvp_responses_event_idx').on(t.eventId)],
);

/**
 * SENSITIVE. Dietary / allergy / accessibility free text, one row per guest.
 * Separate table on purpose: never joined into logs, audit metadata, idempotency responses,
 * AI context, or exports without an explicit `includeNeeds: true`.
 */
export const guestNeeds = pgTable('guest_needs', {
  guestId: text('guest_id')
    .primaryKey()
    .references(() => guests.id, { onDelete: 'cascade' }),
  dietary: text('dietary'),
  accessibility: text('accessibility'),
  updatedBy: jsonb('updated_by').$type<PrincipalRef>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const EMAIL_OUTBOX_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];

/**
 * RSVP confirmation e-mail outbox. Bodies restate the submission but never include needs text.
 * Delivered by the `rsvp.send_confirmation` job through the auth-email provider.
 */
export const rsvpConfirmationEmails = pgTable(
  'rsvp_confirmation_emails',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    recipientGuestId: text('recipient_guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status').$type<EmailOutboxStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    providerMessageId: text('provider_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('rsvp_confirmation_emails_status_idx').on(t.status)],
);

export type RsvpResponseRow = typeof rsvpResponses.$inferSelect;
export type GuestNeedsRow = typeof guestNeeds.$inferSelect;
export type RsvpConfirmationEmailRow = typeof rsvpConfirmationEmails.$inferSelect;
