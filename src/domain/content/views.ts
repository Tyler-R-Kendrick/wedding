import { z } from 'zod';
import { SOURCE_TYPES, TRUST_CLASSES } from '@/contracts/provenance';
import {
  CONTENT_VISIBILITIES, FAQ_CATEGORIES, ITINERARY_BUCKETS, OPERATIONAL_KINDS, PLACE_KINDS, RECOMMENDATION_CATEGORIES, SEASONS, STORY_CHAPTERS, TIMES_OF_DAY, VENUE_FACT_CATEGORIES,
} from '@/db/schema/content';

/**
 * Theme-agnostic view shapes. Capabilities validate their output against these, and the page
 * recipes (Swarm B's real ones or this swarm's placeholders) take them as typed `PageData`.
 * Nothing here knows about a theme; nothing here is a raw database row.
 */

export const textBlockSchema = z.object({ text: z.string(), placeholder: z.boolean() });
export type TextBlockView = z.infer<typeof textBlockSchema>;

export const freshnessSchema = z.enum(['fresh', 'aging', 'stale', 'expired', 'not_yet_valid']);

export const provenanceViewSchema = z.object({
  sourceId: z.string(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceTitle: z.string(),
  url: z.string().optional(),
  verifiedAt: z.string(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  trustClass: z.enum(TRUST_CLASSES),
  contentVersion: z.number().int(),
  editedBy: z.string(),
  freshness: freshnessSchema,
  policy: z.enum(['durable', 'venue-document', 'operational', 'live']),
  external: z.boolean(),
});
export type ProvenanceViewData = z.infer<typeof provenanceViewSchema>;

/** An explicit external handoff ("Open directions in Google Maps"). URL already passed the allowlist. */
export const handoffViewSchema = z.object({
  provider: z.string(),
  label: z.string(),
  url: z.url(),
  disclosure: z.string(),
  opensNewTab: z.boolean(),
});
export type HandoffView = z.infer<typeof handoffViewSchema>;

export const mediaViewSchema = z.object({ alt: z.string(), caption: z.string().optional(), src: z.string().optional() });

export const placeViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  kind: z.enum(PLACE_KINDS),
  address: textBlockSchema.optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  url: z.url().optional(),
  insideVenue: z.boolean(),
  placeholder: z.boolean(),
});
export type PlaceView = z.infer<typeof placeViewSchema>;

export const operationalFieldViewSchema = z.object({
  id: z.string(),
  key: z.string(),
  kind: z.enum(OPERATIONAL_KINDS),
  label: z.string(),
  value: z.string().nullable(),
  url: z.url().nullable(),
  note: textBlockSchema.optional(),
  placeholder: z.boolean(),
  /** True only in admin views that asked for expired records. */
  expired: z.boolean(),
  provenance: provenanceViewSchema,
});
export type OperationalFieldView = z.infer<typeof operationalFieldViewSchema>;

export const recommendationCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  href: z.string(),
  title: z.string(),
  category: z.enum(RECOMMENDATION_CATEGORIES),
  interests: z.array(z.string()),
  what: textBlockSchema,
  place: placeViewSchema.optional(),
  durationMinutes: z.number().int().nullable(),
  distanceFromCaa: textBlockSchema.optional(),
  cost: textBlockSchema.optional(),
  accessibility: textBlockSchema.optional(),
  kidFriendly: z.boolean().nullable(),
  draft: z.boolean(),
  placeholder: z.boolean(),
  /** Live hours/menu link with freshness, when the recommendation points at an operational field. */
  operational: operationalFieldViewSchema.optional(),
  handoffs: z.object({
    directions: handoffViewSchema.optional(),
    booking: handoffViewSchema.optional(),
    /** "Details on the official page" when nothing bookable exists. */
    official: handoffViewSchema.optional(),
  }),
  /** The memory layer. Absent when the linked memory is not visible to this principal. */
  why: z
    .object({
      experienceId: z.string(),
      experienceSlug: z.string(),
      experienceHref: z.string(),
      experienceTitle: z.string(),
      text: textBlockSchema,
    })
    .optional(),
  provenance: provenanceViewSchema,
});
export type RecommendationCard = z.infer<typeof recommendationCardSchema>;

/** Compact card for itinerary stops and composed plans (the full card lives on the recommendation page). */
export const recommendationSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  href: z.string(),
  title: z.string(),
  category: z.enum(RECOMMENDATION_CATEGORIES),
  what: textBlockSchema,
  durationMinutes: z.number().int().nullable(),
  kidFriendly: z.boolean().nullable(),
  draft: z.boolean(),
  placeholder: z.boolean(),
  placeName: z.string().optional(),
});
export type RecommendationSummary = z.infer<typeof recommendationSummarySchema>;

export const adventureCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  href: z.string(),
  title: z.string(),
  summary: textBlockSchema,
  placeName: z.string().optional(),
  dateLabel: textBlockSchema.optional(),
  season: z.enum(SEASONS).optional(),
  timeOfDay: z.enum(TIMES_OF_DAY).optional(),
  tags: z.array(z.string()),
  placeholder: z.boolean(),
  visibility: z.enum(CONTENT_VISIBILITIES),
  provenance: provenanceViewSchema,
});
export type AdventureCard = z.infer<typeof adventureCardSchema>;

export const adventureDetailSchema = adventureCardSchema.extend({
  memory: z.array(textBlockSchema),
  saraMemory: textBlockSchema.optional(),
  tylerMemory: textBlockSchema.optional(),
  place: placeViewSchema.optional(),
  locationLabel: textBlockSchema.optional(),
  durationMinutes: z.number().int().nullable(),
  accessibilityNotes: textBlockSchema.optional(),
  media: z.array(mediaViewSchema),
  related: z.array(recommendationCardSchema),
});
export type AdventureDetail = z.infer<typeof adventureDetailSchema>;

export const itineraryStopViewSchema = z.object({
  recommendation: recommendationSummarySchema,
  minutes: z.number().int().optional(),
  note: z.string().optional(),
});

export const itineraryViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  bucket: z.enum(ITINERARY_BUCKETS),
  intro: textBlockSchema.optional(),
  minMinutes: z.number().int().nullable(),
  maxMinutes: z.number().int().nullable(),
  interests: z.array(z.string()),
  stops: z.array(itineraryStopViewSchema),
  totalMinutes: z.number().int(),
  draft: z.boolean(),
  placeholder: z.boolean(),
  provenance: provenanceViewSchema,
});
export type ItineraryView = z.infer<typeof itineraryViewSchema>;

export const venueSpaceViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  href: z.string(),
  name: z.string(),
  character: z.string(),
  features: z.array(z.string()),
  capacities: z.object({
    ceremony: z.number().int().nullable(),
    dinnerDance: z.number().int().nullable(),
    reception: z.number().int().nullable(),
    note: z.string(),
  }),
  lookForThis: z.array(z.string()),
  provenance: provenanceViewSchema,
});
export type VenueSpaceView = z.infer<typeof venueSpaceViewSchema>;

export const venueFactViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  category: z.enum(VENUE_FACT_CATEGORIES),
  statement: z.string(),
  note: z.string().optional(),
  provenance: provenanceViewSchema,
});
export type VenueFactView = z.infer<typeof venueFactViewSchema>;

export const storySectionViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  chapter: z.enum(STORY_CHAPTERS),
  title: z.string(),
  paragraphs: z.array(textBlockSchema),
  media: z.array(mediaViewSchema),
  placeholder: z.boolean(),
  provenance: provenanceViewSchema,
});
export type StorySectionView = z.infer<typeof storySectionViewSchema>;

export const faqViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  category: z.enum(FAQ_CATEGORIES),
  question: z.string(),
  answer: textBlockSchema,
  route: z.string().optional(),
  placeholder: z.boolean(),
  provenance: provenanceViewSchema,
});
export type FaqView = z.infer<typeof faqViewSchema>;

export const searchResultSchema = z.object({
  id: z.string(),
  kind: z.enum(['story', 'adventure', 'recommendation', 'itinerary', 'venue-space', 'venue-fact', 'operational', 'faq']),
  title: z.string(),
  snippet: z.string(),
  route: z.string(),
  score: z.number(),
  sourceType: z.enum(SOURCE_TYPES),
  trustClass: z.enum(TRUST_CLASSES),
  verifiedAt: z.string(),
  freshness: freshnessSchema,
  /** Present when freshness requires the "last checked, confirm with" caveat. */
  caveat: z.string().optional(),
  recordRef: z.object({ type: z.string(), id: z.string() }),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

/** Wedding-day event skeleton (The Wedding page). Times and rooms are typed placeholders until confirmed. */
export const weddingEventViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  dateIso: z.string(),
  weekdayLabel: z.string(),
  timeLabel: textBlockSchema,
  room: textBlockSchema,
  whatHappens: z.array(textBlockSchema),
  dressCode: textBlockSchema,
  provenance: provenanceViewSchema,
});
export type WeddingEventView = z.infer<typeof weddingEventViewSchema>;
