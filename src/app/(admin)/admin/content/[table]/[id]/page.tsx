import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { getContentRecordCapability } from '@/capabilities/get_content_record';
import { ReviewList } from '@/components/admin/flow/fields';
import { CONTENT_TABLE_NAMES, TABLE_SPECS, type FieldSpec } from '@/domain/content/admin';
import { FRESHNESS_LABELS } from '@/domain/content/freshness';
import { ROUTES } from '@/domain/routes';
import { Breadcrumbs, ConsolePage, Denied, formatStamp, Note, Pill, Section, Stamp } from '../../../_components/console';
import { AdminDenied, adminContentContext } from '../../_auth';
import { ContentRecordFlow, MarkVerified } from '../../_components/ContentFlows';
import { FRESHNESS_TONE } from '../../_components/shared';

export const dynamic = 'force-dynamic';

type Params = Promise<{ table: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { table } = await params;
  const spec = (CONTENT_TABLE_NAMES as readonly string[]).includes(table) ? TABLE_SPECS[table as keyof typeof TABLE_SPECS] : null;
  return { title: spec ? `Edit ${spec.label} · Content (admin)` : 'Content (admin)' };
}

/** A stored value in words, for reading the record back on its own page. */
function shown(f: FieldSpec, v: unknown): string {
  if (f.type === 'boolean') return v === true ? 'Yes' : 'No';
  if (f.type === 'tristate') return v === true ? 'Yes' : v === false ? 'No' : 'Unknown';
  if (v === null || v === undefined || v === '') return '';
  if (f.type === 'datetime') return formatStamp(String(v));
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}

/**
 * One content record: what it says now, its freshness, and its history. Editing it is a flow
 * (the page's main action) that loads the whole record when it opens; marking it verified is one
 * click. Both refresh this page from the server when they land.
 */
export default async function AdminContentEdit({ params }: { params: Params }) {
  const { table, id } = await params;
  if (!(CONTENT_TABLE_NAMES as readonly string[]).includes(table) || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) notFound();
  const spec = TABLE_SPECS[table as keyof typeof TABLE_SPECS];
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
  const record = r.value.data;
  const title = String(record.values[spec.titleField] ?? id);
  const fresh = FRESHNESS_LABELS[record.freshness];

  return (
    <ConsolePage
      title={title}
      actions={
        <>
          <ContentRecordFlow table={table} tableLabel={spec.label} fields={spec.fields} record={{ id, title }} label="Edit this record" accessibleName={`Edit ${title}`} />
          <MarkVerified table={table} id={id} title={title} tone="ghost" />
        </>
      }
    >
      <Breadcrumbs trail={[{ href: ROUTES.adminContent, label: 'Content' }, { href: `${ROUTES.adminContent}/${table}`, label: spec.label }, { label: title }]} />
      <Note>
        Version {record.contentVersion} · last edited by {record.editedBy} on <Stamp at={record.updatedAt} /> · <Pill tone={FRESHNESS_TONE[fresh.tone] ?? 'neutral'}>{fresh.label}</Pill>{' '}
        <Stamp at={String(record.values.verifiedAt)} />
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
      <p className="con-note">“Mark verified” stamps the verification time with now and records a content.verified audit event. It does not change the text.</p>

      <Section title="What it says now" id="record">
        <ReviewList items={spec.fields.map((f) => ({ label: f.label, value: shown(f, record.values[f.name]) }))} />
      </Section>

      <Section title="History" id="history">
        {record.revisions.length === 0 ? (
          <Note>No previous versions.</Note>
        ) : (
          <ul className="list">
            {record.revisions.map((rev) => (
              <li key={rev.contentVersion}>
                v{rev.contentVersion} · {rev.editedBy} · <Stamp at={rev.editedAt} />
                {rev.reason ? ` · ${rev.reason}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </ConsolePage>
  );
}
