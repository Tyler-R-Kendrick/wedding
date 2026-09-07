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
