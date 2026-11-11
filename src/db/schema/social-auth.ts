import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const SOCIAL_PROVIDERS = ['google', 'facebook'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const SOCIAL_REVIEW_REASONS = ['no_match', 'ambiguous', 'not_sent', 'blocked'] as const;
export type SocialReviewReason = (typeof SOCIAL_REVIEW_REASONS)[number];

export const SOCIAL_REVIEW_STATUSES = ['open', 'linked', 'dismissed'] as const;
export type SocialReviewStatus = (typeof SOCIAL_REVIEW_STATUSES)[number];

/**
 * Admin queue for social sign-in attempts that could not be matched automatically.
 * Never stores provider email or phone — only name tokens and opaque provider subject id.
 */
export const socialAuthReviews = pgTable(
  'social_auth_reviews',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').$type<SocialProvider>().notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    profileName: jsonb('profile_name').$type<{ givenName?: string | null; familyName?: string | null; name?: string | null }>().notNull(),
    reason: text('reason').$type<SocialReviewReason>().notNull(),
    candidateGuestIds: jsonb('candidate_guest_ids').$type<string[]>().notNull().default([]),
    status: text('status').$type<SocialReviewStatus>().notNull().default('open'),
    linkedGuestId: text('linked_guest_id'),
    linkedAuthIdentityId: text('linked_auth_identity_id'),
    ipHash: text('ip_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    resolvedBy: jsonb('resolved_by').$type<{ kind: string; id?: string }>(),
  },
  (t) => [
    index('social_auth_reviews_status_idx').on(t.status, t.createdAt),
    index('social_auth_reviews_provider_idx').on(t.providerId, t.providerAccountId),
  ],
);

export type SocialAuthReviewRow = typeof socialAuthReviews.$inferSelect;
