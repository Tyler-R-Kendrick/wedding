import { SOURCE_KEYS } from '@/content/sources';
import { PLACEHOLDER_MARKER } from '@/content/schemas';
import type { ContentRecordsData } from '@/capabilities/list_content_records';
import type { ContentTableName } from '@/db/schema/content';
import { SEED_SOURCES } from '@/db/seed/sources';
import { TABLE_SPECS, VISIBILITY_LABELS, type FieldSpec } from '@/domain/content/admin';
import type { PillTone } from '../../_components/console';
import type { ContentEditor, RefOption, SourceOption } from './types';

export { withArticle } from './types';

/*
 * What the content screens (server components) hand the client flows. Server-only in practice:
 * `TABLE_SPECS` sits beside the database code, so the flows import only the types in `./types`.
 */

/** DESIGN.md freshness tones, mapped onto the console's pill tones. */
export const FRESHNESS_TONE: Record<string, PillTone> = { bad: 'bad', warn: 'warn', ok: 'good' };

/** Where a new record starts: a private draft from the couple's brief, until someone says otherwise. */
export const NEW_RECORD_DEFAULTS: Record<string, string> = {
  sourceId: SOURCE_KEYS.brief,
  sourceType: 'authored',
  trustClass: 'TRUSTED_WEDDING',
  visibility: 'private-draft',
};

/**
 * The sources a record can cite, by name. `content_sources` is written only by the seed from this
 * registry (`db/seed/sources.ts`), and no capability lists it, so the registry is the list. A
 * record citing a source that is not here keeps it: the flow adds it as its own option.
 */
const SOURCES: SourceOption[] = SEED_SOURCES.map((s) => ({
  value: s.id,
  label: s.title,
  sourceType: s.sourceType,
  trustClass: s.trustClass,
  ...(s.canonicalUrl && /^https:\/\//.test(s.canonicalUrl) ? { url: s.canonicalUrl } : {}),
}));

const SOURCE_TITLES = new Map(SOURCES.map((s) => [s.value, s.label]));

/** The tables a spec picks records from (a place, a memory, recommendations). */
export function refTables(table: ContentTableName): ContentTableName[] {
  const out = new Set<ContentTableName>();
  for (const f of TABLE_SPECS[table].fields) {
    if (f.ref) out.add(f.ref);
    for (const i of f.items ?? []) if (i.ref) out.add(i.ref);
  }
  return [...out];
}

/** The records a flow can choose from, by table, from a `list_content_records` read. */
export function refOptions(tables: ContentRecordsData['tables'] | undefined): Record<string, RefOption[]> {
  const out: Record<string, RefOption[]> = {};
  for (const t of tables ?? []) out[t.table] = t.records.map((r) => ({ value: r.id, label: r.title })).sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** Everything the add/edit flow for one table needs, serialisable across to the client. */
export function contentEditor(table: ContentTableName, refs: Record<string, RefOption[]> = {}): ContentEditor {
  const spec = TABLE_SPECS[table];
  return {
    table,
    tableLabel: spec.label,
    noun: spec.noun,
    titleField: spec.titleField,
    fields: spec.fields,
    sources: SOURCES,
    refs: Object.fromEntries(refTables(table).map((t) => [t, refs[t] ?? []])),
    marker: PLACEHOLDER_MARKER,
    defaults: NEW_RECORD_DEFAULTS,
  };
}

/** Who may see a record, as the lists say it. */
export function visibilityWords(v: string): string {
  return VISIBILITY_LABELS[v] ?? v;
}

/** Who made a version, in words. The stored form ("admin:01J…", "seed:brief-2026-09-04") stays under Technical details. */
export function editorWords(editedBy: string): string {
  if (editedBy.startsWith('admin:')) return 'An admin';
  if (editedBy.startsWith('seed:')) return 'The site’s starting content';
  if (editedBy.startsWith('import:')) return 'An import';
  if (editedBy.startsWith('system:') || editedBy.startsWith('job:')) return 'An automatic job';
  return 'Someone';
}

/** Why a version was kept, in words. */
export function revisionWords(reason: string | null): string {
  if (reason === 'update') return 'Edited';
  if (reason === 'verify') return 'Marked verified';
  return 'Changed';
}

/** A stored value in words, for reading the record back on its own page. */
export function describeValue(f: FieldSpec, v: unknown, refs: Record<string, RefOption[]>, formatStamp: (at: string) => string): string {
  if (f.type === 'boolean') return v === true ? 'Yes' : 'No';
  if (f.type === 'tristate') return v === true ? 'Yes' : v === false ? 'No' : 'Not known';
  if (v === null || v === undefined || v === '') return '';
  if (f.name === 'sourceId') return SOURCE_TITLES.get(String(v)) ?? 'A source not in the list';
  if (f.type === 'datetime') return formatStamp(String(v));
  if (f.type === 'select') return f.optionLabels?.[String(v)] ?? String(v);
  const refName = (table: string | undefined, id: unknown) => (table ? refs[table]?.find((o) => o.value === String(id))?.label : undefined) ?? 'A record no longer listed';
  if (f.ref && f.type === 'text') return refName(f.ref, v);
  if (f.type === 'json' && Array.isArray(v)) {
    if (v.length === 0) return '';
    if (f.editor === 'refs') return v.map((id) => refName(f.ref, id)).join(' · ');
    if (f.editor === 'rows') return `${v.length} ${v.length === 1 ? 'row' : 'rows'}`;
    return clip(v.map(String).join(' · '));
  }
  if (f.type === 'json' && f.editor === 'object' && typeof v === 'object') {
    return clip(
      (f.items ?? [])
        .map((i) => {
          const x = (v as Record<string, unknown>)[i.name];
          return x === null || x === undefined || x === '' ? null : `${i.label}: ${String(x)}`;
        })
        .filter(Boolean)
        .join(' · '),
    );
  }
  return clip(typeof v === 'string' ? v : JSON.stringify(v));
}

function clip(text: string): string {
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}
