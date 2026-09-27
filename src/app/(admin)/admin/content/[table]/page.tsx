import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { listContentRecordsCapability } from '@/capabilities/list_content_records';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import { CONTENT_TABLE_NAMES, TABLE_SPECS } from '@/domain/content/admin';
import { PLACEHOLDER_MARKER } from '@/content/schemas';
import { FRESHNESS_LABELS } from '@/domain/content/freshness';
import { ROUTES } from '@/domain/routes';
import { Breadcrumbs, ConsolePage, Day, Denied, Pill } from '../../_components/console';
import { AdminDenied, adminContentContext } from '../_auth';
import { ContentRecordFlow, MarkVerified, MoveRecord } from '../_components/ContentFlows';
import { editorLists } from '../_components/lists';
import { FRESHNESS_TONE, contentEditor, refTables, visibilityWords, withArticle } from '../_components/shared';

export const dynamic = 'force-dynamic';

type Params = Promise<{ table: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { table } = await params;
  const spec = (CONTENT_TABLE_NAMES as readonly string[]).includes(table) ? TABLE_SPECS[table as keyof typeof TABLE_SPECS] : null;
  return { title: spec ? `${spec.label} · Content (admin)` : 'Content (admin)' };
}

/**
 * One content table: every record with its freshness, and the flows that add, edit and re-verify
 * them (`components/admin/flow/CONVENTIONS.md`). A table read in a set order (the FAQ, the story)
 * moves a record with Up and Down; nobody types a position. Each record's own page keeps its history.
 */
export default async function AdminContentTable({ params }: { params: Params }) {
  const { table: name } = await params;
  if (!(CONTENT_TABLE_NAMES as readonly string[]).includes(name)) notFound();
  const table = name as keyof typeof TABLE_SPECS;
  const spec = TABLE_SPECS[table];
  const { ctx, allowed } = await adminContentContext();
  if (!allowed) return <AdminDenied />;
  // The tables this one picks records from (a place, a memory) are read too, so the flow can offer them by name.
  const r = await invoke(listContentRecordsCapability, ctx, refTables(table).length ? {} : { table });
  if (!r.ok) {
    return (
      <ConsolePage title={spec.label}>
        <Breadcrumbs trail={[{ href: ROUTES.adminContent, label: 'Content' }, { label: spec.label }]} />
        <Denied message={r.error.message} />
      </ConsolePage>
    );
  }
  const rows = r.value.data.tables.find((t) => t.table === table)?.records ?? [];
  const editor = contentEditor(table, await editorLists(ctx, [table], r.value.data.tables));
  const ordered = spec.fields.some((f) => f.derive === 'position' && f.name === spec.sortField);
  // Up and Down swap two records' places. A record with no place yet sorts after those that have
  // one, so it moves as if it held the next free number (`swapOrder` then writes real ones).
  const last = Math.max(0, ...rows.map((rec) => rec.position ?? 0));
  const unplacedBefore = (i: number) => rows.slice(0, i).filter((rec) => typeof rec.position !== 'number').length;
  const places = rows.map((rec, i) => (typeof rec.position === 'number' ? rec.position : last + 1 + unplacedBefore(i)));
  const add = `Add ${withArticle(spec.noun)}`;

  return (
    <ConsolePage
      title={spec.label}
      lede={`A new ${spec.noun} starts as a private draft${ordered ? ' at the end of the list' : ''}. Text that still says ${PLACEHOLDER_MARKER} is saved as a placeholder, never shown as a fact.`}
      actions={<ContentRecordFlow editor={editor} label={add} />}
    >
      <Breadcrumbs trail={[{ href: ROUTES.adminContent, label: 'Content' }, { label: spec.label }]} />
      <RecordList label={`${spec.label} records`} empty={rows.length === 0 ? `Nothing here yet. “${add}” starts the first one.` : null}>
        {rows.map((rec, i) => {
          const fresh = FRESHNESS_LABELS[rec.freshness];
          const prev = rows[i - 1];
          const next = rows[i + 1];
          return (
            <RecordRow
              key={rec.id}
              data-record-id={rec.id}
              title={<Link href={`${ROUTES.adminContent}/${table}/${rec.id}`}>{rec.title}</Link>}
              status={
                <>
                  <Pill tone={FRESHNESS_TONE[fresh.tone] ?? 'neutral'}>{fresh.label}</Pill>
                  {rec.placeholder ? <Pill tone="warn">Placeholder</Pill> : null}
                </>
              }
              meta={
                <>
                  {visibilityWords(rec.visibility)} · checked <Day at={rec.verifiedAt} /> · version {rec.contentVersion}
                </>
              }
              actions={
                <>
                  <ContentRecordFlow editor={editor} record={{ id: rec.id, title: rec.title }} label="Edit" variant="quiet" />
                  <MarkVerified table={table} id={rec.id} title={rec.title} />
                  {ordered ? (
                    <>
                      <MoveRecord table={table} record={{ id: rec.id, title: rec.title, sortOrder: places[i]! }} other={prev ? { id: prev.id, title: prev.title, sortOrder: places[i - 1]! } : null} direction="up" />
                      <MoveRecord table={table} record={{ id: rec.id, title: rec.title, sortOrder: places[i]! }} other={next ? { id: next.id, title: next.title, sortOrder: places[i + 1]! } : null} direction="down" />
                    </>
                  ) : null}
                </>
              }
            />
          );
        })}
      </RecordList>
    </ConsolePage>
  );
}
