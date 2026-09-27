import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { getContentRecordCapability } from '@/capabilities/get_content_record';
import { listContentRecordsCapability } from '@/capabilities/list_content_records';
import { ReviewList } from '@/components/admin/flow/fields';
import { CONTENT_TABLE_NAMES, TABLE_SPECS } from '@/domain/content/admin';
import { FRESHNESS_LABELS } from '@/domain/content/freshness';
import { ROUTES } from '@/domain/routes';
import { Breadcrumbs, ConsolePage, Denied, formatStamp, Note, Pill, Section, Stamp } from '../../../_components/console';
import { AdminDenied, adminContentContext } from '../../_auth';
import { ContentRecordFlow, MarkVerified } from '../../_components/ContentFlows';
import { editorLists } from '../../_components/lists';
import { FRESHNESS_TONE, contentEditor, describeValue, editorWords, refTables, revisionWords } from '../../_components/shared';

export const dynamic = 'force-dynamic';

type Params = Promise<{ table: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { table } = await params;
  const spec = (CONTENT_TABLE_NAMES as readonly string[]).includes(table) ? TABLE_SPECS[table as keyof typeof TABLE_SPECS] : null;
  return { title: spec ? `${spec.label} · Content (admin)` : 'Content (admin)' };
}

/**
 * One content record: what it says now, its freshness, and its history. Editing it is a flow
 * (the page's main action) that loads the whole record when it opens; marking it verified is one
 * click. Both refresh this page from the server when they land. Its id, slug and who stored each
 * version are under Technical details.
 */
export default async function AdminContentRecord({ params }: { params: Params }) {
  const { table: name, id } = await params;
  if (!(CONTENT_TABLE_NAMES as readonly string[]).includes(name) || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) notFound();
  const table = name as keyof typeof TABLE_SPECS;
  const spec = TABLE_SPECS[table];
  const { ctx, allowed } = await adminContentContext();
  if (!allowed) return <AdminDenied />;
  const r = await invoke(getContentRecordCapability, ctx, { table, id });
  if (!r.ok) {
    if (r.error.code === 'not_found') notFound();
    return (
      <ConsolePage title={spec.label}>
        <Breadcrumbs trail={[{ href: ROUTES.adminContent, label: 'Content' }, { href: `${ROUTES.adminContent}/${table}`, label: spec.label }]} />
        <Denied message={r.error.message} />
      </ConsolePage>
    );
  }
  // A record that points at others (a place, recommendations) reads them back by name.
  const records = refTables(table).length ? await invoke(listContentRecordsCapability, ctx, {}) : null;
  const editor = contentEditor(table, await editorLists(ctx, [table], records?.ok ? records.value.data.tables : undefined));
  const record = r.value.data;
  const title = String(record.values[spec.titleField] ?? spec.label);
  const fresh = FRESHNESS_LABELS[record.freshness];
  const technical = spec.fields.filter((f) => f.technical || f.derive === 'position');

  return (
    <ConsolePage
      title={title}
      actions={
        <>
          <ContentRecordFlow editor={editor} record={{ id, title }} label="Edit" accessibleName={`Edit ${title}`} />
          <MarkVerified table={table} id={id} title={title} tone="ghost" />
        </>
      }
    >
      <Breadcrumbs trail={[{ href: ROUTES.adminContent, label: 'Content' }, { href: `${ROUTES.adminContent}/${table}`, label: spec.label }, { label: title }]} />
      <Note>
        <Pill tone={FRESHNESS_TONE[fresh.tone] ?? 'neutral'}>{fresh.label}</Pill> Last checked against its source <Stamp at={String(record.values.verifiedAt)} />. Version {record.contentVersion}, last
        changed by {editorWords(record.editedBy).toLowerCase()} on <Stamp at={record.updatedAt} />.
      </Note>
      {record.freshness !== 'fresh' ? (
        <p className="ops-notice ops-notice-error" role="note">
          <strong>{fresh.label}.</strong> Re-check this record against its source
          {record.values.sourceUrl ? (
            <>
              {' ('}
              <a href={String(record.values.sourceUrl)} rel="noopener noreferrer" target="_blank">
                official page
              </a>
              {')'}
            </>
          ) : null}
          , fix anything that changed, then mark it verified.
        </p>
      ) : null}
      <p className="con-note">“Mark verified” records that someone checked it just now. It does not change the text, and the previous version stays in the history.</p>

      <Section title="What it says now" id="record">
        <ReviewList items={spec.fields.filter((f) => !f.technical && f.derive !== 'position').map((f) => ({ label: f.label, value: describeValue(f, record.values[f.name], editor, formatStamp) }))} />
      </Section>

      <Section title="History" id="history">
        {record.revisions.length === 0 ? (
          <Note>No earlier versions.</Note>
        ) : (
          <ul className="list">
            {record.revisions.map((rev) => (
              <li key={rev.contentVersion}>
                Version {rev.contentVersion} · {revisionWords(rev.reason)} by {editorWords(rev.editedBy).toLowerCase()} · <Stamp at={rev.editedAt} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <details className="flow-details">
        <summary>Technical details</summary>
        <div className="flow-details__body">
          <ReviewList
            items={[
              { label: 'Table', value: table },
              { label: 'Record id', value: id },
              ...technical.map((f) => ({ label: f.label, value: describeValue(f, record.values[f.name], editor, formatStamp) })),
              { label: 'Last stored by', value: record.editedBy },
              ...record.revisions.map((rev) => ({ label: `Version ${rev.contentVersion}`, value: `${rev.editedBy} · ${rev.reason ?? 'no reason'}` })),
            ]}
          />
        </div>
      </details>
    </ConsolePage>
  );
}
