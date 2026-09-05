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
 * generic editor form, and the row → form mapping, so every content type gets the same
 * provenance fields (ADR-0011) without nine hand-written editors.
 */
export type FieldType = 'text' | 'textarea' | 'number' | 'float' | 'boolean' | 'tristate' | 'select' | 'json' | 'date' | 'datetime' | 'url';

export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  required?: boolean;
  help?: string;
}

export interface TableSpec {
  label: string;
  /** Field used as the row's display name in lists. */
  titleField: string;
  /** Field used to sort lists. */
  sortField: string;
  fields: FieldSpec[];
}

export const CONTENT_TABLE_NAMES = Object.keys(CONTENT_TABLES) as ContentTableName[];

const PROVENANCE_FIELDS: FieldSpec[] = [
  { name: 'sourceId', label: 'Source (content_sources id)', type: 'text', required: true, help: 'Which registered source backs this record.' },
  { name: 'sourceType', label: 'Source type', type: 'select', options: SOURCE_TYPES, required: true },
  { name: 'sourceUrl', label: 'Source URL (official page)', type: 'url', help: 'Required for official-web records: the page guests are told to confirm with.' },
  { name: 'verifiedAt', label: 'Verified at', type: 'datetime', required: true, help: 'Use "Mark verified" to stamp now.' },
  { name: 'validFrom', label: 'Valid from', type: 'datetime' },
  { name: 'validUntil', label: 'Valid until', type: 'datetime', help: 'Past this instant the record is hidden from guests (e.g. a closed outlet).' },
  { name: 'trustClass', label: 'Trust class', type: 'select', options: TRUST_CLASSES, required: true },
  { name: 'visibility', label: 'Visibility', type: 'select', options: CONTENT_VISIBILITIES, required: true, help: 'private-draft never reaches guests or the concierge.' },
  { name: 'placeholder', label: `Placeholder (contains ${PLACEHOLDER_MARKER})`, type: 'boolean', help: 'Required to be on while any text contains the TODO marker.' },
];

const stringList = 'JSON array of strings, e.g. ["one", "two"]';

export const TABLE_SPECS: Record<ContentTableName, TableSpec> = {
  story_sections: {
    label: 'Our Story',
    titleField: 'title',
    sortField: 'order',
    fields: [
      { name: 'slug', label: 'Slug', type: 'text', required: true },
      { name: 'chapter', label: 'Chapter', type: 'select', options: STORY_CHAPTERS, required: true },
      { name: 'order', label: 'Order', type: 'number', required: true },
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'paragraphs', label: 'Paragraphs', type: 'json', required: true, help: stringList },
      { name: 'media', label: 'Media refs', type: 'json', help: 'JSON array of { alt, caption?, src?, assetId? }' },
      ...PROVENANCE_FIELDS,
    ],
  },
  places: {
    label: 'Places',
    titleField: 'name',
    sortField: 'name',
    fields: [
      { name: 'slug', label: 'Slug', type: 'text', required: true },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'kind', label: 'Kind', type: 'select', options: PLACE_KINDS, required: true },
      { name: 'address', label: 'Address', type: 'text' },
      { name: 'city', label: 'City', type: 'text' },
      { name: 'region', label: 'Region', type: 'text' },
      { name: 'lat', label: 'Latitude', type: 'float' },
      { name: 'lng', label: 'Longitude', type: 'float' },
      { name: 'url', label: 'Official website', type: 'url' },
      { name: 'resySlug', label: 'Resy slug', type: 'text' },
      { name: 'openTableId', label: 'OpenTable id', type: 'text' },
      { name: 'insideVenue', label: 'Inside the CAA', type: 'boolean' },
      ...PROVENANCE_FIELDS,
    ],
  },
  adventure_memories: {
    label: 'Our Adventures',
    titleField: 'title',
    sortField: 'title',
    fields: [
      { name: 'slug', label: 'Slug', type: 'text', required: true },
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'dateExact', label: 'Exact date', type: 'date' },
      { name: 'dateApprox', label: 'Approximate date (wording)', type: 'text' },
      { name: 'season', label: 'Season', type: 'select', options: SEASONS },
      { name: 'timeOfDay', label: 'Time of day', type: 'select', options: TIMES_OF_DAY },
      { name: 'placeId', label: 'Place id', type: 'text' },
      { name: 'locationLabel', label: 'Location label (when there is no place)', type: 'text' },
      { name: 'lat', label: 'Latitude', type: 'float' },
      { name: 'lng', label: 'Longitude', type: 'float' },
      { name: 'summary', label: 'Summary', type: 'textarea', required: true },
      { name: 'memory', label: 'Memory (paragraphs)', type: 'json', help: stringList },
      { name: 'saraMemory', label: 'Sara remembers', type: 'textarea' },
      { name: 'tylerMemory', label: 'Tyler remembers', type: 'textarea' },
      { name: 'media', label: 'Media refs', type: 'json', help: 'JSON array of { alt, caption?, src?, assetId? }' },
      { name: 'tags', label: 'Tags', type: 'json', help: stringList },
      { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number' },
      { name: 'accessibilityNotes', label: 'Accessibility notes', type: 'textarea' },
      { name: 'relatedRecommendationIds', label: 'Related recommendation ids', type: 'json', help: stringList },
      ...PROVENANCE_FIELDS,
    ],
  },
  recommendations: {
    label: 'Share an Adventure',
    titleField: 'title',
    sortField: 'title',
    fields: [
      { name: 'slug', label: 'Slug', type: 'text', required: true },
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'category', label: 'Category', type: 'select', options: RECOMMENDATION_CATEGORIES, required: true },
      { name: 'interests', label: 'Interest tags', type: 'json', help: stringList },
      { name: 'placeId', label: 'Place id', type: 'text' },
      { name: 'what', label: 'What (practical layer)', type: 'textarea', required: true },
      { name: 'durationMinutes', label: 'Suggested minutes', type: 'number' },
      { name: 'distanceFromCaa', label: 'Distance from the CAA', type: 'text' },
      { name: 'cost', label: 'Cost', type: 'text' },
      { name: 'accessibility', label: 'Accessibility', type: 'textarea' },
      { name: 'bookingUrl', label: 'Booking URL (allowlisted)', type: 'url' },
      { name: 'operationalKey', label: 'Operational field key (live hours/menu)', type: 'text' },
      { name: 'experienceId', label: 'Memory id (adventure_memories)', type: 'text' },
      { name: 'whyWeShareThis', label: 'Why we are sharing this', type: 'textarea' },
      { name: 'kidFriendly', label: 'Kid friendly', type: 'tristate' },
      { name: 'draft', label: 'Draft', type: 'boolean' },
      ...PROVENANCE_FIELDS,
    ],
  },
  itinerary_templates: {
    label: 'Itineraries',
    titleField: 'title',
    sortField: 'title',
    fields: [
      { name: 'slug', label: 'Slug', type: 'text', required: true },
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'bucket', label: 'Bucket', type: 'select', options: ITINERARY_BUCKETS, required: true },
      { name: 'intro', label: 'Intro', type: 'textarea' },
      { name: 'minMinutes', label: 'Min minutes', type: 'number' },
      { name: 'maxMinutes', label: 'Max minutes', type: 'number' },
      { name: 'interests', label: 'Interest tags', type: 'json', help: stringList },
      { name: 'stops', label: 'Stops', type: 'json', help: 'JSON array of { recommendationId, minutes?, note? }' },
      { name: 'draft', label: 'Draft', type: 'boolean' },
      ...PROVENANCE_FIELDS,
    ],
  },
  venue_spaces: {
    label: 'CAA spaces',
    titleField: 'name',
    sortField: 'order',
    fields: [
      { name: 'slug', label: 'Slug', type: 'text', required: true },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'order', label: 'Order', type: 'number', required: true },
      { name: 'character', label: 'Character', type: 'textarea', required: true },
      { name: 'features', label: 'Features', type: 'json', help: stringList },
      { name: 'capacities', label: 'Capacities', type: 'json', required: true, help: 'JSON { ceremony, dinnerDance, reception, note } — keep "kit figure" in the note until verified' },
      { name: 'lookForThis', label: 'Look for this', type: 'json', help: stringList },
      ...PROVENANCE_FIELDS,
    ],
  },
  venue_facts: {
    label: 'CAA history',
    titleField: 'statement',
    sortField: 'order',
    fields: [
      { name: 'slug', label: 'Slug', type: 'text', required: true },
      { name: 'order', label: 'Order', type: 'number', required: true },
      { name: 'category', label: 'Category', type: 'select', options: VENUE_FACT_CATEGORIES, required: true },
      { name: 'statement', label: 'Statement', type: 'textarea', required: true },
      { name: 'note', label: 'Editorial note (never rendered as fact)', type: 'textarea' },
      ...PROVENANCE_FIELDS,
    ],
  },
  operational_fields: {
    label: 'Operational fields',
    titleField: 'label',
    sortField: 'order',
    fields: [
      { name: 'key', label: 'Key', type: 'text', required: true, help: 'e.g. outlet.cindys, valet.entrance' },
      { name: 'kind', label: 'Kind', type: 'select', options: OPERATIONAL_KINDS, required: true },
      { name: 'label', label: 'Label', type: 'text', required: true },
      { name: 'value', label: 'Value', type: 'text' },
      { name: 'url', label: 'Official page', type: 'url' },
      { name: 'note', label: 'Note', type: 'textarea' },
      { name: 'order', label: 'Order', type: 'number' },
      ...PROVENANCE_FIELDS,
    ],
  },
  faq_entries: {
    label: 'Ask Us (FAQ)',
    titleField: 'question',
    sortField: 'order',
    fields: [
      { name: 'slug', label: 'Slug', type: 'text', required: true },
      { name: 'order', label: 'Order', type: 'number', required: true },
      { name: 'category', label: 'Category', type: 'select', options: FAQ_CATEGORIES, required: true },
      { name: 'question', label: 'Question', type: 'text', required: true },
      { name: 'answer', label: 'Answer', type: 'textarea', required: true },
      { name: 'route', label: 'Related route', type: 'text' },
      ...PROVENANCE_FIELDS,
    ],
  },
};

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
    return err(new CapabilityError('validation', `This record contains ${PLACEHOLDER_MARKER}; tick "Placeholder" so it never renders as a fact.`, { issues: [{ path: 'placeholder', message: 'must be true while the text contains the placeholder marker' }] }));
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

export interface SaveInput {
  table: ContentTableName;
  id?: string;
  data: unknown;
}

/**
 * Create or update a content record. Every update writes a revision of the previous version,
 * bumps `contentVersion`, stamps the editor, audits `content.updated`, and re-projects the AI corpus.
 */
export async function saveContentRecord(db: Db, input: SaveInput, editor: Editor): Promise<Result<{ id: string; contentVersion: number; created: boolean }, CapabilityError>> {
  const parsed = parseEditable(input.table, input.data);
  if (!parsed.ok) return parsed;
  if (parsed.value.sourceId) {
    const src = await db.select({ id: contentSources.id }).from(contentSources).where(eq(contentSources.id, String(parsed.value.sourceId))).limit(1);
    if (!src[0]) return err(new CapabilityError('validation', 'Unknown source id. Register the source first.', { issues: [{ path: 'sourceId', message: 'unknown content_sources id' }] }));
  }
  const t = tableFor(input.table);
  const values = toRowValues(input.table, parsed.value);
  try {
    if (input.id) {
      const existing = await loadRow(db, input.table, input.id);
      if (!existing) return err(new CapabilityError('not_found', 'That record no longer exists.'));
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
    if (isUniqueViolation(e)) return err(new CapabilityError('conflict', 'Another record already uses that slug or key.'));
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
    };
  });
}

export async function getContentRecord(db: Db, table: ContentTableName, id: string): Promise<Record<string, unknown> | undefined> {
  return loadRow(db, table, id);
}

export async function listRevisions(db: Db, table: ContentTableName, id: string) {
  return db.select().from(contentRevisions).where(eq(contentRevisions.recordId, id)).orderBy(asc(contentRevisions.contentVersion));
}
