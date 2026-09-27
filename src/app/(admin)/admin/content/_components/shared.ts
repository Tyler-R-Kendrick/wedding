import { SOURCE_KEYS } from '@/content/sources';
import { PLACEHOLDER_MARKER } from '@/content/schemas';
import type { ContentSourceView } from '@/capabilities/admin_list_content_sources';
import type { AdventuresPageData } from '@/capabilities/list_adventures';
import type { ContentRecordsData } from '@/capabilities/list_content_records';
import type { ContentTableName } from '@/db/schema/content';
import { TABLE_SPECS, VISIBILITY_LABELS, type ContentPickList, type FieldSpec } from '@/domain/content/admin';
import type { PillTone } from '../../_components/console';
import type { ContentEditor, EditorLists, RefOption, SourceOption } from './types';

export { withArticle } from './types';

/*
 * What the content screens (server components) hand the client flows. Server-only in practice:
 * `TABLE_SPECS` sits beside the database code, so the flows import only the types in `./types`.
 * Nothing here reads the seed: the sources come from `admin_list_content_sources`, the records a
 * field can point at from `list_content_records` and `list_adventures` (`./lists.ts` reads them).
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
 * The sources a record can cite, by name, from `admin_list_content_sources`. A record citing a
 * source that is not here keeps it: the flow adds it as its own option.
 */
export function sourceOptions(rows: readonly ContentSourceView[] | undefined): SourceOption[] {
  return (rows ?? []).map((s) => ({
    value: s.id,
    label: s.title,
    sourceType: s.sourceType,
    trustClass: s.trustClass,
    ...(s.canonicalUrl && /^https:\/\//.test(s.canonicalUrl) ? { url: s.canonicalUrl } : {}),
  }));
}

/** The lists a table's `pick` fields choose from. */
export function pickLists(table: ContentTableName): ContentPickList[] {
  return [...new Set(TABLE_SPECS[table].fields.flatMap((f) => (f.pick ? [f.pick] : [])))];
}

/**
 * The tables a spec picks records from (a place, a memory, recommendations), plus operational
 * fields when it names one by key: every table whose records the page has to read for the flow.
 */
export function refTables(table: ContentTableName): ContentTableName[] {
  const out = new Set<ContentTableName>();
  for (const f of TABLE_SPECS[table].fields) {
    if (f.ref) out.add(f.ref);
    if (f.pick === 'operational') out.add('operational_fields');
    for (const i of f.items ?? []) if (i.ref) out.add(i.ref);
  }
  return [...out];
}

const byLabel = (a: RefOption, b: RefOption) => a.label.localeCompare(b.label);

/** The records a flow can choose from, by table, from a `list_content_records` read. */
export function refOptions(tables: ContentRecordsData['tables'] | undefined): Record<string, RefOption[]> {
  const out: Record<string, RefOption[]> = {};
  for (const t of tables ?? []) out[t.table] = t.records.map((r) => ({ value: r.id, label: r.title })).sort(byLabel);
  return out;
}

/**
 * The records a `pick` field names, by list: adventures by web address name (from
 * `list_adventures`, so only those guests can open), operational fields by key (from
 * `list_content_records`).
 */
export function pickOptions(tables: ContentRecordsData['tables'] | undefined, adventures: AdventuresPageData['items'] | undefined): Record<string, RefOption[]> {
  const operational = tables?.find((t) => t.table === 'operational_fields')?.records ?? [];
  return {
    adventure: (adventures ?? []).map((a) => ({ value: a.slug, label: a.title })).sort(byLabel),
    operational: operational.flatMap((r) => (r.key ? [{ value: r.key, label: r.title }] : [])).sort(byLabel),
  };
}

const NO_LISTS: EditorLists = { sources: [], refs: {}, picks: {} };

/** Everything the add/edit flow for one table needs, serialisable across to the client. */
export function contentEditor(table: ContentTableName, lists: EditorLists = NO_LISTS): ContentEditor {
  const spec = TABLE_SPECS[table];
  return {
    table,
    tableLabel: spec.label,
    noun: spec.noun,
    titleField: spec.titleField,
    fields: spec.fields,
    sources: lists.sources,
    refs: Object.fromEntries(refTables(table).map((t) => [t, lists.refs[t] ?? []])),
    picks: Object.fromEntries(pickLists(table).map((p) => [p, lists.picks[p] ?? []])),
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
export function describeValue(f: FieldSpec, v: unknown, editor: Pick<ContentEditor, 'refs' | 'picks' | 'sources'>, formatStamp: (at: string) => string): string {
  const { refs } = editor;
  if (f.type === 'boolean') return v === true ? 'Yes' : 'No';
  if (f.type === 'tristate') return v === true ? 'Yes' : v === false ? 'No' : 'Not known';
  if (v === null || v === undefined || v === '') return '';
  if (f.name === 'sourceId') return editor.sources.find((s) => s.value === String(v))?.label ?? 'A source not in the list';
  if (f.pick) return editor.picks[f.pick]?.find((o) => o.value === String(v))?.label ?? `${String(v)} (not listed)`;
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
