import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { listContentRecordsCapability } from '@/capabilities/list_content_records';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import { CONTENT_TABLE_NAMES, TABLE_SPECS } from '@/domain/content/admin';
import { FRESHNESS_LABELS } from '@/domain/content/freshness';
import { ROUTES } from '@/domain/routes';
import { Breadcrumbs, ConsolePage, Day, Denied, Pill } from '../../_components/console';
import { AdminDenied, adminContentContext } from '../_auth';
import { ContentRecordFlow, MarkVerified } from '../_components/ContentFlows';
import { FRESHNESS_TONE, NEW_RECORD_DEFAULTS } from '../_components/shared';

export const dynamic = 'force-dynamic';

type Params = Promise<{ table: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { table } = await params;
  const spec = (CONTENT_TABLE_NAMES as readonly string[]).includes(table) ? TABLE_SPECS[table as keyof typeof TABLE_SPECS] : null;
  return { title: spec ? `${spec.label} · Content (admin)` : 'Content (admin)' };
}

/**
 * One content table: every record with its freshness, and the flows that add, edit and re-verify
 * them (`components/admin/flow/CONVENTIONS.md`). Each record's own page keeps its history.
 */
export default async function AdminContentTable({ params }: { params: Params }) {
  const { table } = await params;
  if (!(CONTENT_TABLE_NAMES as readonly string[]).includes(table)) notFound();
  const spec = TABLE_SPECS[table as keyof typeof TABLE_SPECS];
  const { ctx, allowed } = await adminContentContext();
  if (!allowed) return <AdminDenied />;
  const r = await invoke(listContentRecordsCapability, ctx, { table });
  if (!r.ok) {
    return (
      <ConsolePage title={spec.label}>
        <Breadcrumbs trail={[{ href: ROUTES.adminContent, label: 'Content' }, { label: spec.label }]} />
        <Denied message={r.error.message} />
      </ConsolePage>
    );
  }
  const rows = r.value.data.tables[0]?.records ?? [];

  return (
    <ConsolePage
      title={spec.label}
      lede="New records start as private drafts. Any text containing the TODO(Tyler & Sara) marker must have “Placeholder” ticked."
      actions={<ContentRecordFlow table={table} tableLabel={spec.label} fields={spec.fields} defaults={NEW_RECORD_DEFAULTS} label="Add a record" />}
    >
      <Breadcrumbs trail={[{ href: ROUTES.adminContent, label: 'Content' }, { label: spec.label }]} />
      <RecordList label={`${spec.label} records`} empty={rows.length === 0 ? 'Nothing in this table yet.' : null}>
        {rows.map((rec) => {
          const fresh = FRESHNESS_LABELS[rec.freshness];
          return (
            <RecordRow
              key={rec.id}
              data-record-id={rec.id}
              title={<Link href={`${ROUTES.adminContent}/${table}/${rec.id}`}>{rec.title}</Link>}
              status={
                <>
                  <Pill tone={FRESHNESS_TONE[fresh.tone] ?? 'neutral'}>{fresh.label}</Pill>
                  {rec.placeholder ? <Pill tone="warn">placeholder</Pill> : null}
                </>
              }
              meta={
                <>
                  {rec.visibility} · verified <Day at={rec.verifiedAt} /> · version {rec.contentVersion}
                </>
              }
              actions={
                <>
                  <ContentRecordFlow table={table} tableLabel={spec.label} fields={spec.fields} record={{ id: rec.id, title: rec.title }} label="Edit" variant="quiet" />
                  <MarkVerified table={table} id={rec.id} title={rec.title} />
                </>
              }
            />
          );
        })}
      </RecordList>
    </ConsolePage>
  );
}
