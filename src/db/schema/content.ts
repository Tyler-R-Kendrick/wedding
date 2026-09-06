import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { SourceType, TrustClass } from '@/contracts/provenance';

/** Provenance registry: every fact the site shows or the AI cites points at one of these rows. */
export const contentSources = pgTable('content_sources', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').$type<SourceType>().notNull(),
  title: text('title').notNull(),
  canonicalUrl: text('canonical_url'),
  documentName: text('document_name'),
  verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }).notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }),
  validUntil: timestamp('valid_until', { withTimezone: true, mode: 'date' }),
  trustClass: text('trust_class').$type<TrustClass>().notNull(),
  contentVersion: integer('content_version').notNull().default(1),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type ContentSourceRow = typeof contentSources.$inferSelect;

// ---------------------------------------------------------------------------------------------
// Content model (ADR-0011). Every content table below carries the same provenance envelope so
// stale data is visible, versions are retained, and the AI can cite what it retrieved.
// ---------------------------------------------------------------------------------------------

/** Who may see a record. `private-draft` never leaves the admin UI (never guests, never AI). */
export const CONTENT_VISIBILITIES = ['public', 'guest', 'private-draft'] as const;
export type ContentVisibility = (typeof CONTENT_VISIBILITIES)[number];

/** Provenance envelope shared by every content table (ADR-0011). Spread into each table. */
export const provenanceColumns = {
  /** content_sources.id backing this record. */
  sourceId: text('source_id').notNull(),
  sourceType: text('source_type').$type<SourceType>().notNull(),
  /** Official page when sourceType is official-web / provider-api. */
  sourceUrl: text('source_url'),
  verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }).notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }),
  validUntil: timestamp('valid_until', { withTimezone: true, mode: 'date' }),
  trustClass: text('trust_class').$type<TrustClass>().notNull(),
  /** Increments on every edit; previous versions are kept in content_revisions. */
  contentVersion: integer('content_version').notNull().default(1),
  /** Admin identity ("admin:<id>"), seed ("seed:<source>") or job name ("job:<name>"). */
  editedBy: text('edited_by').notNull(),
  visibility: text('visibility').$type<ContentVisibility>().notNull().default('public'),
  /** True when the copy is a typed TODO(Tyler & Sara) placeholder rather than a fact. */
  placeholder: boolean('placeholder').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
} as const;

export const PROVENANCE_COLUMN_NAMES = [
  'source_id', 'source_type', 'source_url', 'verified_at', 'valid_from', 'valid_until', 'trust_class', 'content_version', 'edited_by', 'visibility', 'placeholder',
] as const;

/** Media references are ids into the media swarm's tables plus an accessible description. Never a file. */
export interface MediaRef {
  assetId?: string;
  alt: string;
  caption?: string;
  /** Public path under /public for procedural or ledgered art. */
  src?: string;
}

export const STORY_CHAPTERS = ['met', 'connection', 'relationship', 'love', 'future', 'engagement', 'marriage'] as const;
export type StoryChapter = (typeof STORY_CHAPTERS)[number];

/** Our Story: short, authored chapters in the couple's order. */
export const storySections = pgTable(
  'story_sections',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    chapter: text('chapter').$type<StoryChapter>().notNull(),
    order: integer('order').notNull(),
    title: text('title').notNull(),
    /** Paragraphs of plain text. Placeholder paragraphs contain "TODO(Tyler & Sara)". */
    paragraphs: jsonb('paragraphs').$type<string[]>().notNull(),
    media: jsonb('media').$type<MediaRef[]>().notNull().default([]),
    ...provenanceColumns,
  },
  (t) => [uniqueIndex('story_sections_slug_idx').on(t.slug), index('story_sections_order_idx').on(t.order)],
);

export const PLACE_KINDS = ['venue', 'restaurant', 'park', 'museum', 'farm', 'waterfront', 'neighborhood', 'home', 'other'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** Places in the experience graph. Coordinates and addresses only when known. */
export const places = pgTable(
  'places',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<PlaceKind>().notNull(),
    address: text('address'),
    city: text('city'),
    region: text('region'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    /** Official website (must pass the redirect allowlist to be rendered as a handoff). */
    url: text('url'),
    resySlug: text('resy_slug'),
    openTableId: text('open_table_id'),
    /** True when the place is on the CAA property. */
    insideVenue: boolean('inside_venue').notNull().default(false),
    ...provenanceColumns,
  },
  (t) => [uniqueIndex('places_slug_idx').on(t.slug)],
);

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];
export const TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** The five motifs (brief section 4) plus practical tags. */
export const MOTIF_TAGS = ['adventure', 'place', 'memory', 'hospitality', 'future'] as const;

/**
 * Our Adventures: structured AdventureMemory records. `id` is the ExperienceId that the
 * recommendation layer links back to ("why we're sharing this").
 */
export const adventureMemories = pgTable(
  'adventure_memories',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    dateExact: date('date_exact'),
    /** Human wording when the exact date is unknown or private ("an autumn weekend"). */
    dateApprox: text('date_approx'),
    season: text('season').$type<Season>(),
    timeOfDay: text('time_of_day').$type<TimeOfDay>(),
    placeId: text('place_id'),
    /** Free-text location when there is no place record ("our garden"). */
    locationLabel: text('location_label'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    summary: text('summary').notNull(),
    /** Longer memory, paragraphs. */
    memory: jsonb('memory').$type<string[]>().notNull().default([]),
    saraMemory: text('sara_memory'),
    tylerMemory: text('tyler_memory'),
    media: jsonb('media').$type<MediaRef[]>().notNull().default([]),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    durationMinutes: integer('duration_minutes'),
    accessibilityNotes: text('accessibility_notes'),
    relatedRecommendationIds: jsonb('related_recommendation_ids').$type<string[]>().notNull().default([]),
    ...provenanceColumns,
  },
  (t) => [uniqueIndex('adventure_memories_slug_idx').on(t.slug), index('adventure_memories_place_idx').on(t.placeId)],
);

export const RECOMMENDATION_CATEGORIES = ['food-drink', 'architecture', 'outdoors', 'with-kids', 'culture', 'stay-inside-caa', 'day-trip', 'neighborhood'] as const;
export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

/** Share an Adventure: the practical layer plus an optional memory link. */
export const recommendations = pgTable(
  'recommendations',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    category: text('category').$type<RecommendationCategory>().notNull(),
    /** Interest tags used by itinerary composition (e.g. "architecture", "food", "kids", "inside-caa", "walk"). */
    interests: jsonb('interests').$type<string[]>().notNull().default([]),
    placeId: text('place_id'),
    what: text('what').notNull(),
    durationMinutes: integer('duration_minutes'),
    /** Text so "a short walk" and "about 90 minutes by car" both fit; null when unverified. */
    distanceFromCaa: text('distance_from_caa'),
    cost: text('cost'),
    accessibility: text('accessibility'),
    /** Admin-configured booking URL (allowlisted) when the reservations provider has no deep link. */
    bookingUrl: text('booking_url'),
    /** operational_fields.key for hours/menus that must stay live (e.g. "outlet.cindys"). */
    operationalKey: text('operational_key'),
    /** Memory layer: the experience this recommendation grew out of, and why the couple shares it. */
    experienceId: text('experience_id'),
    whyWeShareThis: text('why_we_share_this'),
    kidFriendly: boolean('kid_friendly'),
    /** Drafts until curated by the couple; drafts render with a "draft" badge, never silently. */
    draft: boolean('draft').notNull().default(true),
    ...provenanceColumns,
  },
  (t) => [uniqueIndex('recommendations_slug_idx').on(t.slug), index('recommendations_experience_idx').on(t.experienceId), index('recommendations_category_idx').on(t.category)],
);

export const ITINERARY_BUCKETS = ['45-min', '2-3-h', 'friday-afternoon', 'saturday-morning', 'with-kids', 'architecture', 'food-drink', 'stay-inside-caa'] as const;
export type ItineraryBucket = (typeof ITINERARY_BUCKETS)[number];

export interface ItineraryStop {
  recommendationId: string;
  minutes?: number;
  note?: string;
}

/** Curated itineraries. All seeded ones are drafts until the couple curates them. */
export const itineraryTemplates = pgTable(
  'itinerary_templates',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    bucket: text('bucket').$type<ItineraryBucket>().notNull(),
    intro: text('intro'),
    minMinutes: integer('min_minutes'),
    maxMinutes: integer('max_minutes'),
    interests: jsonb('interests').$type<string[]>().notNull().default([]),
    stops: jsonb('stops').$type<ItineraryStop[]>().notNull().default([]),
    draft: boolean('draft').notNull().default(true),
    ...provenanceColumns,
  },
  (t) => [uniqueIndex('itinerary_templates_slug_idx').on(t.slug), index('itinerary_templates_bucket_idx').on(t.bucket)],
);

export interface SpaceCapacities {
  ceremony: number | null;
  dinnerDance: number | null;
  reception: number | null;
  /** Always present for kit figures: "kit figure — verify". */
  note: string;
}

/** CAA event spaces from the kit. Capacities are kit figures until the planner verifies them. */
export const venueSpaces = pgTable(
  'venue_spaces',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    order: integer('order').notNull(),
    character: text('character').notNull(),
    features: jsonb('features').$type<string[]>().notNull().default([]),
    capacities: jsonb('capacities').$type<SpaceCapacities>().notNull(),
    /** Self-guided "look for this" details a guest can find in the room. */
    lookForThis: jsonb('look_for_this').$type<string[]>().notNull().default([]),
    ...provenanceColumns,
  },
  (t) => [uniqueIndex('venue_spaces_slug_idx').on(t.slug)],
);

export const VENUE_FACT_CATEGORIES = ['history', 'architecture', 'restoration', 'materials', 'setting', 'look-for-this'] as const;
export type VenueFactCategory = (typeof VENUE_FACT_CATEGORIES)[number];

/** Durable, cited history. Safe as prose because each row cites its source. */
export const venueFacts = pgTable(
  'venue_facts',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    order: integer('order').notNull(),
    category: text('category').$type<VenueFactCategory>().notNull(),
    statement: text('statement').notNull(),
    /** Editorial note that never renders as fact (e.g. "designation date reported inconsistently: not published"). */
    note: text('note'),
    ...provenanceColumns,
  },
  (t) => [uniqueIndex('venue_facts_slug_idx').on(t.slug)],
);

export const OPERATIONAL_KINDS = ['outlet', 'amenity', 'hours', 'menu', 'valet', 'parking', 'accessibility', 'transit', 'package', 'other'] as const;
export type OperationalKind = (typeof OPERATIONAL_KINDS)[number];

/**
 * Operational facts are data, never prose (ADR-0011 rule 2). Outlets, hours, menus, parking,
 * accessibility. Past `validUntil` a record is not shown to guests (the closed Milk Room and
 * Cherry Circle Room are seeded exactly this way).
 */
export const operationalFields = pgTable(
  'operational_fields',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    kind: text('kind').$type<OperationalKind>().notNull(),
    label: text('label').notNull(),
    value: text('value'),
    /** Official page for this fact; rendered as the "confirm with" link. */
    url: text('url'),
    note: text('note'),
    order: integer('order').notNull().default(0),
    ...provenanceColumns,
  },
  (t) => [uniqueIndex('operational_fields_key_idx').on(t.key), index('operational_fields_kind_idx').on(t.kind)],
);

export const FAQ_CATEGORIES = ['basics', 'dress', 'kids', 'plus-ones', 'parking', 'weather', 'photos', 'accessibility', 'contact', 'gifts', 'travel'] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

/** Ask Us: the FAQ that works without the concierge. */
export const faqEntries = pgTable(
  'faq_entries',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    order: integer('order').notNull(),
    category: text('category').$type<FaqCategory>().notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    /** Related internal route for "see also". */
    route: text('route'),
    ...provenanceColumns,
  },
  (t) => [uniqueIndex('faq_entries_slug_idx').on(t.slug)],
);

/** Every edit keeps the previous version (ADR-0011 rule 6). Append-only. */
export const contentRevisions = pgTable(
  'content_revisions',
  {
    id: text('id').primaryKey(),
    table: text('table_name').notNull(),
    recordId: text('record_id').notNull(),
    contentVersion: integer('content_version').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    editedBy: text('edited_by').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    reason: text('reason'),
  },
  (t) => [index('content_revisions_record_idx').on(t.table, t.recordId, t.contentVersion)],
);

export type StorySectionRow = typeof storySections.$inferSelect;
export type PlaceRow = typeof places.$inferSelect;
export type AdventureMemoryRow = typeof adventureMemories.$inferSelect;
export type RecommendationRow = typeof recommendations.$inferSelect;
export type ItineraryTemplateRow = typeof itineraryTemplates.$inferSelect;
export type VenueSpaceRow = typeof venueSpaces.$inferSelect;
export type VenueFactRow = typeof venueFacts.$inferSelect;
export type OperationalFieldRow = typeof operationalFields.$inferSelect;
export type FaqEntryRow = typeof faqEntries.$inferSelect;
export type ContentRevisionRow = typeof contentRevisions.$inferSelect;

/** Row shape shared by every content table (used by provenance helpers and the generic admin editor). */
export type ProvenanceRow = Pick<
  StorySectionRow,
  'sourceId' | 'sourceType' | 'sourceUrl' | 'verifiedAt' | 'validFrom' | 'validUntil' | 'trustClass' | 'contentVersion' | 'editedBy' | 'visibility' | 'placeholder' | 'createdAt' | 'updatedAt'
>;

/** All content tables keyed by their SQL name, for schema tests and the generic editor. */
export const CONTENT_TABLES = {
  story_sections: storySections,
  places,
  adventure_memories: adventureMemories,
  recommendations,
  itinerary_templates: itineraryTemplates,
  venue_spaces: venueSpaces,
  venue_facts: venueFacts,
  operational_fields: operationalFields,
  faq_entries: faqEntries,
} as const;
export type ContentTableName = keyof typeof CONTENT_TABLES;
