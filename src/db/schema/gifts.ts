import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';

export const GIFT_LINK_KINDS = ['registry', 'adventure-fund'] as const;
export type GiftLinkKind = (typeof GIFT_LINK_KINDS)[number];

/**
 * Provider-neutral registry / "help us with our next adventures" descriptors configured by
 * admins. The site only describes where to go (ADR-0004): no checkout, no card data, no
 * purchase state. URLs must pass the redirect allowlist at write time AND at read time.
 */
export const giftLinks = pgTable('gift_links', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<GiftLinkKind>().notNull(),
  /** 'theknot' | 'zola' | 'withjoy' | 'custom' (any allowlisted host). */
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  note: text('note'),
  url: text('url').notNull(),
  disclosure: text('disclosure'),
  /** True until the couple supply the real link (backlog C-06): rendered as an editorial placeholder, never as a fact. */
  placeholder: boolean('placeholder').notNull().default(true),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  sourceId: text('source_id'),
  verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
  updatedBy: jsonb('updated_by').$type<PrincipalRef>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type GiftLinkRow = typeof giftLinks.$inferSelect;

/**
 * Where a gift of money goes (ADR-0013). Each rail is the couple's OWN account on a payment network
 * guests already use; the site builds the provider's documented link from the handle and hands the
 * guest over. It never takes a payment, never holds one, and never knows whether one was made.
 *
 * - `venmo`, `paypal`, `cashapp`: a public profile handle; the link is computed, never pasted.
 * - `zelle`: the email or US mobile number the couple enrolled. Personal, so guests see it only once
 *   they have opened the site from their invitation.
 * - `check`: a mailing address, one line per row. Personal for the same reason.
 */
export const GIFT_RAILS = ['zelle', 'venmo', 'paypal', 'cashapp', 'check'] as const;
export type GiftRail = (typeof GIFT_RAILS)[number];

export const giftPaymentRails = pgTable('gift_payment_rails', {
  rail: text('rail').$type<GiftRail>().primaryKey(),
  handle: text('handle').notNull(),
  /** The name the app shows (or the check's payee), so a guest can confirm they have the right person. */
  recipientName: text('recipient_name'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedBy: jsonb('updated_by').$type<PrincipalRef>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type GiftPaymentRailRow = typeof giftPaymentRails.$inferSelect;

/**
 * What a gift of money is FOR: honeymoon, home, adoption, next adventures. The defaults live in code
 * (`src/domain/gifts/funds.ts`) so they exist without a seed; a row with the same id overrides a
 * default's words, order or visibility, and a row with a new id adds a fund.
 */
export const giftFunds = pgTable('gift_funds', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedBy: jsonb('updated_by').$type<PrincipalRef>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type GiftFundRow = typeof giftFunds.$inferSelect;
