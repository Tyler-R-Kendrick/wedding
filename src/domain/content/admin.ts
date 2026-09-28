import { asc, eq } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { PLACEHOLDER_MARKER, isPlaceholderText } from '@/content/schemas';
import type { AuditSink } from '@/contracts/audit';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import { SOURCE_TYPES, TRUST_CLASSES, type Freshness } from '@/contracts/provenance';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import {
  CONTENT_TABLES, CONTENT_VISIBILITIES, FAQ_CATEGORIES, ITINERARY_BUCKETS, OPERATIONAL_KINDS, PLACE_KINDS, RECOMMENDATION_CATEGORIES, SEASONS, STORY_CHAPTERS, TIMES_OF_DAY, VENUE_FACT_CATEGORIES,
  contentRevisions, contentSources, type ContentTableName,
} from '@/db/schema';
import { projectKnowledge } from '@/domain/knowledge/projection';
import { computeFreshness, daysSinceVerified } from './freshness';

/**
 * Spec-driven admin editing. One field spec per table drives the zod validation, the
 * generic editor flow, and the row → form mapping, so every content type gets the same
 * provenance fields (ADR-0011) without nine hand-written editors.
 *
 * The spec also says how each field is *asked for* (`components/admin/flow/CONVENTIONS.md`): the
 * admin never types an id. A slug or key is derived from the title (`derive`, filled in by
 * `saveContentRecord`), a list position is set by where the record sits (`derive: 'position'`,
 * moved with Up and Down), a source or another record is chosen from a list (`ref`), and a JSON
 * value is edited as lines or rows (`editor`). Internals sit under "Technical details"
 * (`technical`), and every stored enum has a label in words (`optionLabels`).
 */
export type FieldType = 'text' | 'textarea' | 'number' | 'float' | 'boolean' | 'tristate' | 'select' | 'json' | 'date' | 'datetime' | 'url';

/** One column of a `rows` or `object` editor (a media item's alt text, a stop's minutes). */
export interface SubFieldSpec {
  name: string;
  label: string;
  type: 'text' | 'number';
  required?: boolean;
  help?: string;
  /** The value is another record's id, chosen from this table. */
  ref?: ContentTableName;
  /** The shortest answer that is not too short (a photo's alt text). */
  minLength?: number;
  /** What the value has to start with (an image address starts with "/"). */
  startsWith?: string;
}

export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  /** The stored `options` in words, for the flow and the record page. Filled in for every select. */
  optionLabels?: Record<string, string>;
  required?: boolean;
  help?: string;
  /** What to say when a required field is empty: a sentence naming what to enter. */
  ask?: string;
  /**
   * Filled in on save when left empty: `slug` from the title, `key` from the kind and label,
   * `position` at the end of the list. An empty value on an edit keeps the stored one.
   */
  derive?: 'slug' | 'key' | 'position';
  /** An internal the admin rarely needs: shown only under a closed "Technical details". */
  technical?: boolean;
  /** `text`: another record's id, chosen from this table. `json` with `editor: 'refs'`: several. */
  ref?: ContentTableName;
  /**
   * `text`: another record named by its web address name or key rather than its id, chosen from a
   * list: `adventure` (an Our Adventures memory guests can open, from `list_adventures`),
   * `operational` (an operational field's key, from `list_content_records`).
   */
  pick?: ContentPickList;
  /**
   * How a `json` field is edited: `lines` (a string array, one per line), `tags` (lowercase words,
   * one per line), `refs` (records ticked from `ref`), `rows` (an array of objects, one row each),
   * `object` (one object, a field per key).
   */
  editor?: 'lines' | 'tags' | 'refs' | 'rows' | 'object';
  /** The columns of a `rows` or `object` editor. */
  items?: SubFieldSpec[];
  /** One row of a `rows` editor, in words: "Photo", "Stop". */
  itemLabel?: string;
}

/** The lists a `pick` field chooses from (`FieldSpec.pick`). */
export type ContentPickList = 'adventure' | 'operational';

export interface TableSpec {
  label: string;
  /** One record, in words, for the flows' buttons: "Add a question", "Save question". */
  noun: string;
  /** Field used as the row's display name in lists. */
  titleField: string;
  /** Field used to sort lists. */
  sortField: string;
  fields: FieldSpec[];
}

export const CONTENT_TABLE_NAMES = Object.keys(CONTENT_TABLES) as ContentTableName[];

/**
 * Stored values in words. Anything not listed reads as its value with the dashes taken out and a
 * capital first letter ("architecture" → "Architecture").
 */
const OPTION_WORDS: Record<string, string> = {
  // How far the concierge trusts it (TRUST_CLASSES).
  TRUSTED_WEDDING: 'Ours: written or checked by the couple',
  EXTERNAL_DATA: 'Outside data: a venue, a website, a provider',
  UNTRUSTED_USER_CONTENT: 'Written by a guest: never followed as instructions',
  // Who may see it (CONTENT_VISIBILITIES).
  public: 'Everyone',
  guest: 'Signed-in guests',
  'private-draft': 'Private draft: only admins',
  // Itinerary kinds, recommendation categories and FAQ topics that do not read as words.
  '45-min': '45 minutes',
  '2-3-h': 'Two to three hours',
  'food-drink': 'Food and drink',
  'with-kids': 'With kids',
  'stay-inside-caa': 'Without leaving the CAA',
  'day-trip': 'Day trip',
  'friday-afternoon': 'Friday afternoon',
  'saturday-morning': 'Saturday morning',
  'look-for-this': 'Look for this',
  'plus-ones': 'Plus-ones',
};

/** A stored enum value in words ("private-draft" → "Private draft: only admins"). */
export function optionLabel(value: string): string {
  const known = OPTION_WORDS[value];
  if (known) return known;
  const words = value.replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where a record's facts come from (SOURCE_TYPES). Its own map: `guest` means something else here. */
const SOURCE_TYPE_WORDS: Record<string, string> = {
  authored: 'Written by us',
  contract: 'A signed contract',
  'venue-document': 'A venue document',
  'official-web': 'An official website',
  'provider-api': 'Live data from a provider',
  admin: 'Typed in here',
  guest: 'Sent in by a guest',
};

/** Who may see a record, as the lists say it. */
export const VISIBILITY_LABELS: Record<string, string> = { public: 'Everyone', guest: 'Signed-in guests', 'private-draft': 'Private draft' };

const PROVENANCE_FIELDS: FieldSpec[] = [
  { name: 'sourceId', label: 'Where this comes from', type: 'text', required: true, ask: 'Choose where this record comes from.', help: 'The document, website or person the facts come from. Guests see it as “Based on …”.' },
  { name: 'sourceType', label: 'Kind of source', type: 'select', options: SOURCE_TYPES, optionLabels: SOURCE_TYPE_WORDS, required: true, technical: true, ask: 'Choose what kind of source this is.', help: 'Set from the source you chose. Change it only if this record differs.' },
  { name: 'sourceUrl', label: 'Official page', type: 'url', help: 'Needed when the source is an official website: the page guests are told to check. It starts with https://.' },
  { name: 'verifiedAt', label: 'Last checked against the source', type: 'datetime', required: true, ask: 'Enter when this was last checked against its source.', help: 'A new record starts at now. “Mark verified” on the list sets it to now later.' },
  { name: 'validFrom', label: 'Shown from', type: 'datetime', help: 'Leave empty to show it straight away.' },
  { name: 'validUntil', label: 'Hidden after', type: 'datetime', help: 'After this time guests stop seeing it (a restaurant that has closed, a menu that has changed).' },
  { name: 'trustClass', label: 'How far the concierge trusts it', type: 'select', options: TRUST_CLASSES, required: true, technical: true, ask: 'Choose how far the concierge trusts this.', help: 'Set from the source you chose.' },
  { name: 'visibility', label: 'Who can see it', type: 'select', options: CONTENT_VISIBILITIES, required: true, ask: 'Choose who can see this record.', help: 'A private draft never reaches guests or the concierge.' },
  { name: 'placeholder', label: 'This is still a placeholder', type: 'boolean', help: `Ticked for you while any text says ${PLACEHOLDER_MARKER}. A placeholder is never shown as a fact.` },
];

const lines = (name: string, label: string, help: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, label, type: 'json', editor: 'lines', help: `${help} Put each one on its own line.`, ...extra });
const tags = { type: 'json', editor: 'tags', help: 'One word or short phrase per line, like “architecture” or “rainy-day”.' } as const;
const slug: FieldSpec = { name: 'slug', label: 'Web address name', type: 'text', required: true, derive: 'slug', technical: true, help: 'The last part of this record’s web address. Made from the title when left empty; kept as it is when you edit the title later.' };
const position = (required: boolean): FieldSpec => ({ name: 'order', label: 'Position in the list', type: 'number', required, derive: 'position' });
const media: FieldSpec = {
  name: 'media',
  label: 'Photos',
  type: 'json',
  editor: 'rows',
  itemLabel: 'Photo',
  help: 'One row per photo. Alt text describes the photo for anyone who cannot see it.',
  items: [
    { name: 'alt', label: 'Alt text', type: 'text', required: true, minLength: 3 },
    { name: 'caption', label: 'Caption', type: 'text' },
    { name: 'src', label: 'Image address', type: 'text', startsWith: '/', help: 'Starts with /, like /photos/starved-rock.jpg.' },
  ],
};

const SPECS: Record<ContentTableName, TableSpec> = {
  story_sections: {
    label: 'Our Story',
    noun: 'story section',
    titleField: 'title',
    sortField: 'order',
    fields: [
      slug,
      { name: 'chapter', label: 'Chapter', type: 'select', options: STORY_CHAPTERS, required: true, ask: 'Choose the chapter this belongs to.' },
      position(true),
      { name: 'title', label: 'Title', type: 'text', required: true, ask: 'Give the section a title.' },
      lines('paragraphs', 'Paragraphs', 'The section’s text.', { required: true, ask: 'Write at least one paragraph.' }),
      media,
      ...PROVENANCE_FIELDS,
    ],
  },
  timeline_moments: {
    label: 'Our Story timeline',
    noun: 'timeline stop',
    titleField: 'title',
    sortField: 'order',
    fields: [
      slug,
      { name: 'chapter', label: 'Line', type: 'select', options: STORY_CHAPTERS, required: true, ask: 'Choose the line this stop sits on.' },
      position(true),
      { name: 'title', label: 'Station name', type: 'text', required: true, ask: 'Give the stop a station name.' },
      { name: 'occurredOn', label: 'When', type: 'text', help: 'Only as exact as you know it: 2019-06-14, 2019-06 or 2019.' },
      { name: 'locationLabel', label: 'Where', type: 'text' },
      { name: 'note', label: 'Note', type: 'textarea', required: true, ask: 'Write a short note about this stop.' },
      media,
      { name: 'adventureSlug', label: 'Adventure it opens', type: 'text', pick: 'adventure', help: 'Choose it from Our Adventures. Only adventures guests can open are listed.' },
      { name: 'externalRef', label: 'Imported from', type: 'text', technical: true, help: 'Set by the Paired import (“paired:…”). Leave it as it is.' },
      ...PROVENANCE_FIELDS,
    ],
  },
  places: {
    label: 'Places',
    noun: 'place',
    titleField: 'name',
    sortField: 'name',
    fields: [
      slug,
      { name: 'name', label: 'Name', type: 'text', required: true, ask: 'Give the place a name.' },
      { name: 'kind', label: 'Kind of place', type: 'select', options: PLACE_KINDS, required: true, ask: 'Choose what kind of place this is.' },
      { name: 'address', label: 'Address', type: 'text' },
      { name: 'city', label: 'City', type: 'text' },
      { name: 'region', label: 'State or region', type: 'text' },
      { name: 'lat', label: 'Latitude', type: 'float', help: 'From a map, like 41.8819.' },
      { name: 'lng', label: 'Longitude', type: 'float', help: 'From a map, like -87.6244.' },
      { name: 'url', label: 'Official website', type: 'url' },
      { name: 'insideVenue', label: 'Inside the CAA', type: 'boolean' },
      { name: 'resySlug', label: 'Resy name', type: 'text', technical: true, help: 'The restaurant’s name in its Resy web address.' },
      { name: 'openTableId', label: 'OpenTable number', type: 'text', technical: true, help: 'The restaurant’s number in its OpenTable web address.' },
      ...PROVENANCE_FIELDS,
    ],
  },
  adventure_memories: {
    label: 'Our Adventures',
    noun: 'adventure',
    titleField: 'title',
    sortField: 'title',
    fields: [
      slug,
      { name: 'title', label: 'Title', type: 'text', required: true, ask: 'Give the adventure a title.' },
      { name: 'dateExact', label: 'Date', type: 'date', help: 'When you know the day.' },
      { name: 'dateApprox', label: 'Roughly when', type: 'text', help: 'When you do not, in words: “the summer of 2021”.' },
      { name: 'season', label: 'Season', type: 'select', options: SEASONS },
      { name: 'timeOfDay', label: 'Time of day', type: 'select', options: TIMES_OF_DAY },
      { name: 'placeId', label: 'Place', type: 'text', ref: 'places', help: 'Choose it from Places. Add the place there first if it is missing.' },
      { name: 'locationLabel', label: 'Where, in words', type: 'text', help: 'When there is no place to choose.' },
      { name: 'lat', label: 'Latitude', type: 'float' },
      { name: 'lng', label: 'Longitude', type: 'float' },
      { name: 'summary', label: 'Summary', type: 'textarea', required: true, ask: 'Write a short summary of the adventure.' },
      lines('memory', 'The memory', 'The story in paragraphs.'),
      { name: 'saraMemory', label: 'Sara remembers', type: 'textarea' },
      { name: 'tylerMemory', label: 'Tyler remembers', type: 'textarea' },
      media,
      { name: 'tags', label: 'Tags', ...tags },
      { name: 'durationMinutes', label: 'How long it takes (minutes)', type: 'number' },
      { name: 'accessibilityNotes', label: 'Accessibility notes', type: 'textarea' },
      { name: 'relatedRecommendationIds', label: 'Related recommendations', type: 'json', editor: 'refs', ref: 'recommendations', help: 'Tick the Share an Adventure entries that go with this memory.' },
      ...PROVENANCE_FIELDS,
    ],
  },
  recommendations: {
    label: 'Share an Adventure',
    noun: 'recommendation',
    titleField: 'title',
    sortField: 'title',
    fields: [
      slug,
      { name: 'title', label: 'Title', type: 'text', required: true, ask: 'Give the recommendation a title.' },
      { name: 'category', label: 'Category', type: 'select', options: RECOMMENDATION_CATEGORIES, required: true, ask: 'Choose a category.' },
      { name: 'interests', label: 'Interests', ...tags },
      { name: 'placeId', label: 'Place', type: 'text', ref: 'places', help: 'Choose it from Places. Add the place there first if it is missing.' },
      { name: 'what', label: 'What it is', type: 'textarea', required: true, ask: 'Say what it is and how to do it.', help: 'The practical part: what, where, how.' },
      { name: 'durationMinutes', label: 'Suggested time (minutes)', type: 'number' },
      { name: 'distanceFromCaa', label: 'Distance from the CAA', type: 'text', help: 'In words, like “a 5-minute walk”.' },
      { name: 'cost', label: 'Cost', type: 'text' },
      { name: 'accessibility', label: 'Accessibility', type: 'textarea' },
      { name: 'bookingUrl', label: 'Booking link', type: 'url', help: 'Only sites on the approved list open from the page.' },
      { name: 'experienceId', label: 'Our Adventures memory', type: 'text', ref: 'adventure_memories', help: 'The memory this recommendation comes from, if any.' },
      { name: 'whyWeShareThis', label: 'Why we are sharing this', type: 'textarea' },
      { name: 'kidFriendly', label: 'Good with kids', type: 'tristate' },
      { name: 'draft', label: 'Still a draft', type: 'boolean' },
      { name: 'operationalKey', label: 'Live hours or menu', type: 'text', pick: 'operational', help: 'The operational detail whose hours or menu this shows. Add it under Operational fields first if it is missing.' },
      ...PROVENANCE_FIELDS,
    ],
  },
  itinerary_templates: {
    label: 'Itineraries',
    noun: 'itinerary',
    titleField: 'title',
    sortField: 'title',
    fields: [
      slug,
      { name: 'title', label: 'Title', type: 'text', required: true, ask: 'Give the itinerary a title.' },
      { name: 'bucket', label: 'Kind of plan', type: 'select', options: ITINERARY_BUCKETS, required: true, ask: 'Choose what kind of plan this is.' },
      { name: 'intro', label: 'Introduction', type: 'textarea' },
      { name: 'minMinutes', label: 'Shortest time (minutes)', type: 'number' },
      { name: 'maxMinutes', label: 'Longest time (minutes)', type: 'number' },
      { name: 'interests', label: 'Interests', ...tags },
      {
        name: 'stops',
        label: 'Stops',
        type: 'json',
        editor: 'rows',
        itemLabel: 'Stop',
        help: 'One row per stop, in the order guests make them.',
        items: [
          { name: 'recommendationId', label: 'Recommendation', type: 'text', required: true, ref: 'recommendations' },
          { name: 'minutes', label: 'Minutes', type: 'number' },
          { name: 'note', label: 'Note', type: 'text' },
        ],
      },
      { name: 'draft', label: 'Still a draft', type: 'boolean' },
      ...PROVENANCE_FIELDS,
    ],
  },
  venue_spaces: {
    label: 'CAA spaces',
    noun: 'space',
    titleField: 'name',
    sortField: 'order',
    fields: [
      slug,
      { name: 'name', label: 'Name', type: 'text', required: true, ask: 'Give the space a name.' },
      position(true),
      { name: 'character', label: 'What it is like', type: 'textarea', required: true, ask: 'Describe what the space is like.' },
      lines('features', 'Features', 'What the space has.'),
      {
        name: 'capacities',
        label: 'How many it holds',
        type: 'json',
        editor: 'object',
        required: true,
        ask: 'Say how many the space holds, or say where the figures come from.',
        help: 'Leave a number empty when you do not know it.',
        items: [
          { name: 'ceremony', label: 'Ceremony', type: 'number' },
          { name: 'dinnerDance', label: 'Dinner and dancing', type: 'number' },
          { name: 'reception', label: 'Reception', type: 'number' },
          { name: 'note', label: 'Note on the figures', type: 'text', required: true, minLength: 3, help: 'Until you have checked them, say they are the venue’s own figures.' },
        ],
      },
      lines('lookForThis', 'Look for this', 'Details guests can look out for.'),
      ...PROVENANCE_FIELDS,
    ],
  },
  venue_facts: {
    label: 'CAA history',
    noun: 'history fact',
    titleField: 'statement',
    sortField: 'order',
    fields: [
      slug,
      position(true),
      { name: 'category', label: 'Topic', type: 'select', options: VENUE_FACT_CATEGORIES, required: true, ask: 'Choose the topic this fact is about.' },
      { name: 'statement', label: 'The fact', type: 'textarea', required: true, ask: 'Write the fact as guests will read it.' },
      { name: 'note', label: 'Note for us', type: 'textarea', help: 'Never shown as a fact.' },
      ...PROVENANCE_FIELDS,
    ],
  },
  operational_fields: {
    label: 'Operational fields',
    noun: 'operational detail',
    titleField: 'label',
    sortField: 'order',
    fields: [
      { name: 'key', label: 'Key', type: 'text', required: true, derive: 'key', technical: true, help: 'How recommendations point at this detail, like outlet.cindys. Made from the kind and name when left empty.' },
      { name: 'kind', label: 'Kind', type: 'select', options: OPERATIONAL_KINDS, required: true, ask: 'Choose what kind of detail this is.' },
      { name: 'label', label: 'Name', type: 'text', required: true, ask: 'Give the detail a name, like “Cindy’s hours”.' },
      { name: 'value', label: 'What it says', type: 'text' },
      { name: 'url', label: 'Official page', type: 'url' },
      { name: 'note', label: 'Note', type: 'textarea' },
      position(false),
      ...PROVENANCE_FIELDS,
    ],
  },
  faq_entries: {
    label: 'Ask Us (FAQ)',
    noun: 'question',
    titleField: 'question',
    sortField: 'order',
    fields: [
      slug,
      position(true),
      { name: 'category', label: 'Topic', type: 'select', options: FAQ_CATEGORIES, required: true, ask: 'Choose the topic this question is about.' },
      { name: 'question', label: 'Question', type: 'text', required: true, ask: 'Write the question as a guest would ask it.' },
      { name: 'answer', label: 'Answer', type: 'textarea', required: true, ask: 'Write the answer.' },
      { name: 'route', label: 'Related page', type: 'text', help: 'A page on this site that says more, like /travel.' },
      ...PROVENANCE_FIELDS,
    ],
  },
};

/** Every select gets its options in words. */
export const TABLE_SPECS: Record<ContentTableName, TableSpec> = Object.fromEntries(
  Object.entries(SPECS).map(([name, spec]) => [
    name,
    { ...spec, fields: spec.fields.map((f) => (f.options && !f.optionLabels ? { ...f, optionLabels: Object.fromEntries(f.options.map((o) => [o, optionLabel(o)])) } : f)) },
  ]),
) as Record<ContentTableName, TableSpec>;

const stringArray = z.array(z.string().min(1));
const JSON_FIELD_SCHEMAS: Record<string, z.ZodType> = {
  paragraphs: stringArray.min(1),
  memory: stringArray,
  tags: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  interests: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  relatedRecommendationIds: stringArray,
  features: stringArray,
  lookForThis: stringArray,
  media: z.array(z.object({ assetId: z.string().optional(), alt: z.string().min(3), caption: z.string().optional(), src: z.string().startsWith('/').optional() })),
  stops: z.array(z.object({ recommendationId: z.string().min(1), minutes: z.number().int().positive().optional(), note: z.string().optional() })),
  capacities: z.object({ ceremony: z.number().int().positive().nullable(), dinnerDance: z.number().int().positive().nullable(), reception: z.number().int().positive().nullable(), note: z.string().min(3) }),
};

const isoInstant = z.iso.datetime({ offset: true });

function fieldSchema(f: FieldSpec): z.ZodType {
  const nullable = <T extends z.ZodType>(s: T) => (f.required ? s : s.nullable());
  switch (f.type) {
    case 'text':
      return f.required ? z.string().trim().min(1).max(2000) : z.string().trim().max(2000).nullable();
    case 'textarea':
      return f.required ? z.string().trim().min(1).max(20_000) : z.string().trim().max(20_000).nullable();
    case 'url':
      return nullable(z.url({ protocol: /^https$/ }));
    case 'number':
      return nullable(z.number().int());
    case 'float':
      return nullable(z.number());
    case 'boolean':
      return z.boolean();
    case 'tristate':
      return z.boolean().nullable();
    case 'select':
      return nullable(z.enum(f.options as [string, ...string[]]));
    case 'date':
      return nullable(z.iso.date());
    case 'datetime':
      return nullable(isoInstant);
    case 'json':
      return f.required ? JSON_FIELD_SCHEMAS[f.name] ?? z.unknown() : (JSON_FIELD_SCHEMAS[f.name] ?? z.unknown()).nullable();
  }
}

const schemaCache = new Map<ContentTableName, z.ZodObject>();

/** Strict zod object for a table's editable fields, derived from its spec. */
export function editableSchema(table: ContentTableName): z.ZodObject {
  const hit = schemaCache.get(table);
  if (hit) return hit;
  const shape: Record<string, z.ZodType> = {};
  for (const f of TABLE_SPECS[table].fields) shape[f.name] = fieldSchema(f);
  const schema = z.object(shape).strict();
  schemaCache.set(table, schema);
  return schema;
}

function textValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => textValues(v, out));
  else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach((v) => textValues(v, out));
  return out;
}

/** Parses untrusted form/tool data for a table. Enforces the placeholder invariant. */
export function parseEditable(table: ContentTableName, data: unknown): Result<Record<string, unknown>, CapabilityError> {
  const parsed = editableSchema(table).safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
    return err(new CapabilityError('validation', 'Please check the highlighted fields.', { issues }));
  }
  const record = parsed.data as Record<string, unknown>;
  if (record.placeholder !== true && textValues(record).some(isPlaceholderText)) {
    return err(new CapabilityError('validation', `This record contains ${PLACEHOLDER_MARKER}; tick “This is still a placeholder” so it never renders as a fact.`, { issues: [{ path: 'placeholder', message: 'must be true while the text contains the placeholder marker' }] }));
  }
  if (record.sourceType === 'official-web' && !record.sourceUrl) {
    return err(new CapabilityError('validation', 'Official-web records need the official page URL guests are told to confirm with.', { issues: [{ path: 'sourceUrl', message: 'required for official-web' }] }));
  }
  const from = record.validFrom as string | null | undefined;
  const until = record.validUntil as string | null | undefined;
  if (from && until && Date.parse(from) > Date.parse(until)) {
    return err(new CapabilityError('validation', 'Valid-from must be before valid-until.', { issues: [{ path: 'validUntil', message: 'before validFrom' }] }));
  }
  return ok(record);
}

/** Converts a form's string values into the typed shape `parseEditable` expects. */
export function coerceFormValues(table: ContentTableName, raw: Record<string, string | undefined>): Result<Record<string, unknown>, CapabilityError> {
  const out: Record<string, unknown> = {};
  const issues: { path: string; message: string }[] = [];
  for (const f of TABLE_SPECS[table].fields) {
    const v = raw[f.name];
    const empty = v === undefined || v.trim() === '';
    switch (f.type) {
      case 'boolean':
        out[f.name] = v === 'on' || v === 'true';
        break;
      case 'tristate':
        out[f.name] = v === 'yes' ? true : v === 'no' ? false : null;
        break;
      case 'number':
      case 'float':
        if (empty) out[f.name] = null;
        else {
          const n = Number(v);
          if (!Number.isFinite(n)) issues.push({ path: f.name, message: 'must be a number' });
          out[f.name] = n;
        }
        break;
      case 'json':
        if (empty) out[f.name] = f.required ? undefined : null;
        else {
          try {
            out[f.name] = JSON.parse(v);
          } catch {
            issues.push({ path: f.name, message: 'must be valid JSON' });
          }
        }
        break;
      case 'datetime':
        out[f.name] = empty ? null : toIso(v!);
        break;
      default:
        out[f.name] = empty ? null : v!.trim();
    }
  }
  if (issues.length) return err(new CapabilityError('validation', 'Please check the highlighted fields.', { issues }));
  return ok(out);
}

/** Accepts "2026-09-05T10:00" from a datetime-local input or a full ISO string. */
function toIso(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

/** Row → form values (strings) for the editor. */
export function toFormValues(table: ContentTableName, row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of TABLE_SPECS[table].fields) {
    const v = row[f.name];
    if (v === null || v === undefined) {
      out[f.name] = '';
      continue;
    }
    switch (f.type) {
      case 'json':
        out[f.name] = JSON.stringify(v, null, 2);
        break;
      case 'boolean':
        out[f.name] = v ? 'on' : '';
        break;
      case 'tristate':
        out[f.name] = v === true ? 'yes' : v === false ? 'no' : '';
        break;
      case 'datetime':
        out[f.name] = v instanceof Date ? v.toISOString() : String(v);
        break;
      default:
        out[f.name] = v instanceof Date ? v.toISOString() : String(v);
    }
  }
  return out;
}

// --------------------------------------------------------------------------------- writes

type ContentTable = PgTable & { id: AnyPgColumn; contentVersion: AnyPgColumn; verifiedAt: AnyPgColumn };

const tableFor = (name: ContentTableName): ContentTable => CONTENT_TABLES[name] as unknown as ContentTable;

export interface Editor {
  actor: PrincipalRef;
  /** "admin:<id>" or "system:<component>"; stored on the row and every revision. */
  editedBy: string;
  requestId: string;
  audit: AuditSink;
  now: Date;
}

export interface ContentRecordSummary {
  id: string;
  title: string;
  contentVersion: number;
  verifiedAt: string;
  validUntil?: string;
  visibility: string;
  placeholder: boolean;
  freshness: Freshness;
  daysSinceVerified: number;
  sourceType: string;
  /** The record's web address name or key (its `derive: 'slug' | 'key'` field), when the table has one. */
  key?: string;
  /** Its place in a hand-ordered list (`derive: 'position'`); `null` when it has none yet. */
  position?: number | null;
}

async function loadRow(db: Db, table: ContentTableName, id: string): Promise<Record<string, unknown> | undefined> {
  const t = tableFor(table);
  const rows = (await db.select().from(t).where(eq(t.id, id)).limit(1)) as Record<string, unknown>[];
  return rows[0];
}

/** Row → editable data with Date columns as ISO strings (what the editor and `parseEditable` use). */
export function rowToEditable(table: ContentTableName, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of TABLE_SPECS[table].fields) {
    const v = row[f.name];
    out[f.name] = v instanceof Date ? v.toISOString() : (v ?? null);
  }
  return out;
}

function toRowValues(table: ContentTableName, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of TABLE_SPECS[table].fields) {
    const v = data[f.name];
    if (f.type === 'datetime') out[f.name] = v ? new Date(v as string) : null;
    else if (v === undefined) out[f.name] = null;
    else out[f.name] = v;
  }
  return out;
}

async function recordRevision(db: Db, table: ContentTableName, row: Record<string, unknown>, editor: Editor, reason: string) {
  await db.insert(contentRevisions).values({
    id: newId(),
    table,
    recordId: String(row.id),
    contentVersion: Number(row.contentVersion ?? 1),
    snapshot: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
    editedBy: editor.editedBy,
    editedAt: editor.now,
    reason,
  });
}

function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.message} ${(e as { cause?: { message?: string } }).cause?.message ?? ''}` : String(e);
  return /unique|duplicate key/i.test(msg);
}

/** A title as the last part of a web address: "Cindy's Rooftop" → "cindys-rooftop". */
export function slugify(text: unknown): string {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * The values the admin is never asked to type (`FieldSpec.derive`). On an edit, an empty one keeps
 * what is stored. On a new record, a slug comes from the title and a key from the kind and name,
 * each made unique in its table ("-2", "-3"), and a position puts the record at the end of the list.
 * Anything the admin did type is kept as typed; the schema and the unique index still check it.
 */
async function fillDerived(db: Db, table: ContentTableName, data: unknown, existing: Record<string, unknown> | undefined): Promise<unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const spec = TABLE_SPECS[table];
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  const t = tableFor(table) as ContentTable & Record<string, AnyPgColumn>;
  for (const f of spec.fields) {
    if (!f.derive || !blank(out[f.name])) continue;
    if (existing) {
      out[f.name] = existing[f.name] ?? null;
      continue;
    }
    const col = t[f.name];
    if (!col) continue;
    const taken = ((await db.select({ v: col }).from(t)) as { v: unknown }[]).map((r) => r.v);
    if (f.derive === 'position') {
      const numbers = taken.filter((v): v is number => typeof v === 'number');
      out[f.name] = numbers.length ? Math.max(...numbers) + 1 : 1;
      continue;
    }
    const name = slugify(out[spec.titleField]) || slugify(spec.noun);
    const base = f.derive === 'key' && !blank(out.kind) ? `${String(out.kind)}.${name}` : name;
    const used = new Set(taken.map(String));
    let candidate = base;
    for (let n = 2; used.has(candidate); n += 1) candidate = `${base}-${n}`;
    out[f.name] = candidate;
  }
  return out;
}

export interface SaveInput {
  table: ContentTableName;
  id?: string;
  data: unknown;
  /**
   * Edits only: `data` holds just the fields that change (a list position) and every other field
   * keeps its stored value. The whole record is still validated, versioned and audited as one save.
   */
  merge?: boolean;
}

/**
 * Create or update a content record. Every update writes a revision of the previous version,
 * bumps `contentVersion`, stamps the editor, audits `content.updated`, and re-projects the AI corpus.
 */
export async function saveContentRecord(db: Db, input: SaveInput, editor: Editor): Promise<Result<{ id: string; contentVersion: number; created: boolean }, CapabilityError>> {
  const current = input.id ? await loadRow(db, input.table, input.id) : undefined;
  if (input.id && !current) return err(new CapabilityError('not_found', 'That record no longer exists.'));
  if (input.merge && !current) return err(new CapabilityError('validation', 'Only an existing record can be changed a field at a time.'));
  const data = input.merge && current && input.data && typeof input.data === 'object' ? { ...rowToEditable(input.table, current), ...(input.data as Record<string, unknown>) } : input.data;
  const parsed = parseEditable(input.table, await fillDerived(db, input.table, data, current));
  if (!parsed.ok) return parsed;
  if (parsed.value.sourceId) {
    const src = await db.select({ id: contentSources.id }).from(contentSources).where(eq(contentSources.id, String(parsed.value.sourceId))).limit(1);
    if (!src[0]) return err(new CapabilityError('validation', 'That source is not registered. Choose one from the list.', { issues: [{ path: 'sourceId', message: 'unknown content_sources id' }] }));
  }
  const t = tableFor(input.table);
  const values = toRowValues(input.table, parsed.value);
  try {
    if (input.id) {
      const existing = current!;
      await recordRevision(db, input.table, existing, editor, 'update');
      const contentVersion = Number(existing.contentVersion ?? 1) + 1;
      await db
        .update(t)
        .set({ ...values, contentVersion, editedBy: editor.editedBy, updatedAt: editor.now } as never)
        .where(eq(t.id, input.id));
      await editor.audit.record({ actor: editor.actor, action: 'content.updated', target: { type: input.table, id: input.id }, outcome: 'success', requestId: editor.requestId, metadata: { contentVersion, created: false } });
      await projectKnowledge(db, editor.now);
      return ok({ id: input.id, contentVersion, created: false });
    }
    const id = newId();
    await db.insert(t).values({ id, ...values, contentVersion: 1, editedBy: editor.editedBy, createdAt: editor.now, updatedAt: editor.now } as never);
    await editor.audit.record({ actor: editor.actor, action: 'content.updated', target: { type: input.table, id }, outcome: 'success', requestId: editor.requestId, metadata: { contentVersion: 1, created: true } });
    await projectKnowledge(db, editor.now);
    return ok({ id, contentVersion: 1, created: true });
  } catch (e) {
    if (isUniqueViolation(e)) return err(new CapabilityError('conflict', 'Another record already uses that web address name or key. Change it under Technical details.'));
    throw e;
  }
}

/** Stamps `verifiedAt` (default now), keeps the previous version, audits `content.verified`. */
export async function markContentVerified(
  db: Db,
  input: { table: ContentTableName; id: string; verifiedAt?: string },
  editor: Editor,
): Promise<Result<{ id: string; verifiedAt: string; contentVersion: number; previousVerifiedAt: string }, CapabilityError>> {
  const existing = await loadRow(db, input.table, input.id);
  if (!existing) return err(new CapabilityError('not_found', 'That record no longer exists.'));
  const verifiedAt = input.verifiedAt ? new Date(input.verifiedAt) : editor.now;
  if (Number.isNaN(verifiedAt.getTime()) || verifiedAt.getTime() > editor.now.getTime() + 60_000) {
    return err(new CapabilityError('validation', 'The verification time must be a valid time, not in the future.', { issues: [{ path: 'verifiedAt', message: 'invalid or in the future' }] }));
  }
  const previous = existing.verifiedAt instanceof Date ? existing.verifiedAt : new Date(String(existing.verifiedAt));
  await recordRevision(db, input.table, existing, editor, 'verify');
  const contentVersion = Number(existing.contentVersion ?? 1) + 1;
  const t = tableFor(input.table);
  await db
    .update(t)
    .set({ verifiedAt, contentVersion, editedBy: editor.editedBy, updatedAt: editor.now } as never)
    .where(eq(t.id, input.id));
  await editor.audit.record({
    actor: editor.actor,
    action: 'content.verified',
    target: { type: input.table, id: input.id },
    outcome: 'success',
    requestId: editor.requestId,
    metadata: { contentVersion, previousVerifiedAt: previous.toISOString(), verifiedAt: verifiedAt.toISOString(), sourceType: String(existing.sourceType) },
  });
  await projectKnowledge(db, editor.now);
  return ok({ id: input.id, verifiedAt: verifiedAt.toISOString(), contentVersion, previousVerifiedAt: previous.toISOString() });
}

/** Admin list with freshness so stale records stand out. */
export async function listContentRecords(db: Db, table: ContentTableName, now: Date): Promise<ContentRecordSummary[]> {
  const spec = TABLE_SPECS[table];
  const t = tableFor(table) as ContentTable & Record<string, AnyPgColumn>;
  const sortCol = t[spec.sortField];
  const keyField = spec.fields.find((f) => f.derive === 'slug' || f.derive === 'key');
  const positionField = spec.fields.find((f) => f.derive === 'position');
  const rows = (await db
    .select()
    .from(t)
    .orderBy(sortCol ? asc(sortCol) : asc(t.id))) as Record<string, unknown>[];
  return rows.map((r) => {
    const verifiedAt = r.verifiedAt as Date;
    const validUntil = (r.validUntil as Date | null) ?? undefined;
    return {
      id: String(r.id),
      title: String(r[spec.titleField] ?? r.id),
      contentVersion: Number(r.contentVersion),
      verifiedAt: verifiedAt.toISOString(),
      ...(validUntil ? { validUntil: validUntil.toISOString() } : {}),
      visibility: String(r.visibility),
      placeholder: Boolean(r.placeholder),
      freshness: computeFreshness({ sourceType: r.sourceType as never, verifiedAt, validFrom: r.validFrom as Date | null, validUntil: validUntil ?? null }, now),
      daysSinceVerified: daysSinceVerified(verifiedAt, now),
      sourceType: String(r.sourceType),
      ...(keyField && typeof r[keyField.name] === 'string' ? { key: String(r[keyField.name]) } : {}),
      ...(positionField ? { position: typeof r[positionField.name] === 'number' ? (r[positionField.name] as number) : null } : {}),
    };
  });
}

export async function getContentRecord(db: Db, table: ContentTableName, id: string): Promise<Record<string, unknown> | undefined> {
  return loadRow(db, table, id);
}

export async function listRevisions(db: Db, table: ContentTableName, id: string) {
  return db.select().from(contentRevisions).where(eq(contentRevisions.recordId, id)).orderBy(asc(contentRevisions.contentVersion));
}
