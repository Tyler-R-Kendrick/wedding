import { z } from 'zod';
import { SOURCE_TYPES, TRUST_CLASSES } from '@/contracts/provenance';
import {
  CONTENT_VISIBILITIES, FAQ_CATEGORIES, ITINERARY_BUCKETS, OPERATIONAL_KINDS, PLACE_KINDS, RECOMMENDATION_CATEGORIES,
  SEASONS, STORY_CHAPTERS, TIMES_OF_DAY, VENUE_FACT_CATEGORIES,
} from '@/db/schema/content';
import { SOURCE_KEYS } from './sources';

/** The marker that turns a sentence into a typed placeholder. Never renders as a plain fact. */
export const PLACEHOLDER_MARKER = 'TODO(Tyler & Sara)';
export const isPlaceholderText = (s: string | null | undefined): boolean => typeof s === 'string' && s.includes(PLACEHOLDER_MARKER);

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case slug');
const isoInstant = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const httpsUrl = z.url({ protocol: /^https$/ });
const sourceKey = z.enum(Object.keys(SOURCE_KEYS) as [keyof typeof SOURCE_KEYS, ...(keyof typeof SOURCE_KEYS)[]]);

/** Provenance envelope as written in the seed JSON (ADR-0011). */
export const provenanceSeedSchema = z.object({
  sourceKey,
  sourceType: z.enum(SOURCE_TYPES),
  sourceUrl: httpsUrl.optional(),
  verifiedAt: isoInstant,
  validFrom: isoInstant.optional(),
  validUntil: isoInstant.optional(),
  trustClass: z.enum(TRUST_CLASSES),
  editedBy: z.string().min(3),
  visibility: z.enum(CONTENT_VISIBILITIES).default('public'),
  placeholder: z.boolean().default(false),
});
export type ProvenanceSeed = z.infer<typeof provenanceSeedSchema>;

const mediaRef = z.object({ assetId: z.string().optional(), alt: z.string().min(3), caption: z.string().optional(), src: z.string().startsWith('/').optional() });

/** Collects every free-text value of a record so the placeholder invariant can be checked. */
function textValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => textValues(v, out));
  else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach((v) => textValues(v, out));
  return out;
}

/** Invariant: any record containing the marker must be flagged `placeholder: true`. */
const placeholderInvariant = <T extends { placeholder: boolean }>(record: T, ctx: z.RefinementCtx) => {
  if (!record.placeholder && textValues(record).some(isPlaceholderText)) {
    ctx.addIssue({ code: 'custom', message: `contains ${PLACEHOLDER_MARKER} but placeholder is false`, path: ['placeholder'] });
  }
};

export const storySectionSeedSchema = provenanceSeedSchema
  .extend({
    slug,
    chapter: z.enum(STORY_CHAPTERS),
    order: z.number().int().min(1),
    title: z.string().min(2).max(120),
    paragraphs: z.array(z.string().min(1)).min(1),
    media: z.array(mediaRef).default([]),
  })
  .superRefine(placeholderInvariant);

export const placeSeedSchema = provenanceSeedSchema
  .extend({
    slug,
    name: z.string().min(2).max(120),
    kind: z.enum(PLACE_KINDS),
    address: z.string().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    url: httpsUrl.optional(),
    resySlug: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
    openTableId: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
    insideVenue: z.boolean().default(false),
  })
  .superRefine(placeholderInvariant);

export const adventureMemorySeedSchema = provenanceSeedSchema
  .extend({
    slug,
    title: z.string().min(2).max(120),
    dateExact: isoDate.optional(),
    dateApprox: z.string().optional(),
    season: z.enum(SEASONS).optional(),
    timeOfDay: z.enum(TIMES_OF_DAY).optional(),
    placeSlug: slug.optional(),
    locationLabel: z.string().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    summary: z.string().min(2).max(400),
    memory: z.array(z.string().min(1)).default([]),
    saraMemory: z.string().optional(),
    tylerMemory: z.string().optional(),
    media: z.array(mediaRef).default([]),
    tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
    durationMinutes: z.number().int().positive().optional(),
    accessibilityNotes: z.string().optional(),
    relatedRecommendationSlugs: z.array(slug).default([]),
  })
  .superRefine(placeholderInvariant);

export const recommendationSeedSchema = provenanceSeedSchema
  .extend({
    slug,
    title: z.string().min(2).max(120),
    category: z.enum(RECOMMENDATION_CATEGORIES),
    interests: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
    placeSlug: slug.optional(),
    what: z.string().min(2).max(600),
    durationMinutes: z.number().int().positive().optional(),
    distanceFromCaa: z.string().optional(),
    cost: z.string().optional(),
    accessibility: z.string().optional(),
    bookingUrl: httpsUrl.optional(),
    operationalKey: z.string().regex(/^[a-z0-9.-]+$/).optional(),
    experienceSlug: slug.optional(),
    whyWeShareThis: z.string().optional(),
    kidFriendly: z.boolean().optional(),
    draft: z.boolean().default(true),
  })
  .superRefine(placeholderInvariant);

export const itineraryStopSeedSchema = z.object({
  recommendationSlug: slug,
  minutes: z.number().int().positive().optional(),
  note: z.string().optional(),
});

export const itineraryTemplateSeedSchema = provenanceSeedSchema
  .extend({
    slug,
    title: z.string().min(2).max(120),
    bucket: z.enum(ITINERARY_BUCKETS),
    intro: z.string().optional(),
    minMinutes: z.number().int().positive().optional(),
    maxMinutes: z.number().int().positive().optional(),
    interests: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
    stops: z.array(itineraryStopSeedSchema).default([]),
    draft: z.boolean().default(true),
  })
  .superRefine(placeholderInvariant);

export const venueSpaceSeedSchema = provenanceSeedSchema
  .extend({
    slug,
    name: z.string().min(2).max(120),
    order: z.number().int().min(1),
    character: z.string().min(2),
    features: z.array(z.string().min(1)).default([]),
    capacities: z.object({
      ceremony: z.number().int().positive().nullable(),
      dinnerDance: z.number().int().positive().nullable(),
      reception: z.number().int().positive().nullable(),
      note: z.string().min(3),
    }),
    lookForThis: z.array(z.string().min(1)).default([]),
  })
  .superRefine(placeholderInvariant);

export const venueFactSeedSchema = provenanceSeedSchema
  .extend({
    slug,
    order: z.number().int().min(1),
    category: z.enum(VENUE_FACT_CATEGORIES),
    statement: z.string().min(2).max(400),
    note: z.string().optional(),
  })
  .superRefine(placeholderInvariant);

export const operationalFieldSeedSchema = provenanceSeedSchema
  .extend({
    key: z.string().regex(/^[a-z0-9.-]+$/),
    kind: z.enum(OPERATIONAL_KINDS),
    label: z.string().min(2).max(120),
    value: z.string().optional(),
    url: httpsUrl.optional(),
    note: z.string().optional(),
    order: z.number().int().min(0).default(0),
  })
  .superRefine(placeholderInvariant);

export const faqEntrySeedSchema = provenanceSeedSchema
  .extend({
    slug,
    order: z.number().int().min(1),
    category: z.enum(FAQ_CATEGORIES),
    question: z.string().min(5).max(200),
    answer: z.string().min(2).max(1200),
    route: z.string().startsWith('/').optional(),
  })
  .superRefine(placeholderInvariant);

export const contentSeedSchema = z.object({
  story: z.array(storySectionSeedSchema),
  places: z.array(placeSeedSchema),
  adventures: z.array(adventureMemorySeedSchema),
  recommendations: z.array(recommendationSeedSchema),
  itineraries: z.array(itineraryTemplateSeedSchema),
  venueSpaces: z.array(venueSpaceSeedSchema),
  venueFacts: z.array(venueFactSeedSchema),
  operationalFields: z.array(operationalFieldSeedSchema),
  faq: z.array(faqEntrySeedSchema),
});

export type StorySectionSeed = z.infer<typeof storySectionSeedSchema>;
export type PlaceSeed = z.infer<typeof placeSeedSchema>;
export type AdventureMemorySeed = z.infer<typeof adventureMemorySeedSchema>;
export type RecommendationSeed = z.infer<typeof recommendationSeedSchema>;
export type ItineraryTemplateSeed = z.infer<typeof itineraryTemplateSeedSchema>;
export type VenueSpaceSeed = z.infer<typeof venueSpaceSeedSchema>;
export type VenueFactSeed = z.infer<typeof venueFactSeedSchema>;
export type OperationalFieldSeed = z.infer<typeof operationalFieldSeedSchema>;
export type FaqEntrySeed = z.infer<typeof faqEntrySeedSchema>;
export type ContentSeed = z.infer<typeof contentSeedSchema>;

/** Editable shapes for the admin editors: the seed schema minus the source key, plus the source id. */
export const editableSchemas = {
  story_sections: storySectionSeedSchema,
  places: placeSeedSchema,
  adventure_memories: adventureMemorySeedSchema,
  recommendations: recommendationSeedSchema,
  itinerary_templates: itineraryTemplateSeedSchema,
  venue_spaces: venueSpaceSeedSchema,
  venue_facts: venueFactSeedSchema,
  operational_fields: operationalFieldSeedSchema,
  faq_entries: faqEntrySeedSchema,
} as const;
