import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { getContentRecordCapability } from '@/capabilities/get_content_record';
import { newId } from '@/contracts/ids';
import { CONTENT_TABLE_NAMES, TABLE_SPECS, toFormValues } from '@/domain/content/admin';
import { FRESHNESS_LABELS } from '@/domain/content/freshness';
import { ROUTES } from '@/domain/routes';
import { Breadcrumbs, ConsolePage, Note, Pill, Section, Stamp } from '../../../_components/console';
import { Button, IdemKey } from '../../../_components/ops';
import { AdminDenied, adminContentContext } from '../../_auth';
import { RecordForm } from '../../_form';
import { FRESHNESS_TONE } from '../../page';
import { markVerifiedAction } from '../../actions';

export const dynamic = 'force-dynamic';

type Params = Promise<{ table: string; id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AdminContentEdit({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { table, id } = await params;
  const sp = await searchParams;
  if (!(CONTENT_TABLE_NAMES as readonly string[]).includes(table) || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) notFound();
  const spec = TABLE_SPECS[table as keyof typeof TABLE_SPECS];
  const { ctx, allowed } = await adminContentContext();
  if (!allowed) return <AdminDenied />;
  const r = await invoke(getContentRecordCapability, ctx, { table, id });
  if (!r.ok) {
    if (r.error.code === 'not_found') notFound();
    throw new Error(r.error.message);
  }
  const record = r.value.data;
  const values = toFormValues(table as keyof typeof TABLE_SPECS, record.values);
  const title = String(record.values[spec.titleField] ?? id);
  const fresh = FRESHNESS_LABELS[record.freshness];
  const saved = one(sp.saved);
  const verified = one(sp.verified);
  const error = one(sp.error);
  const message = one(sp.message);

  return (
    <ConsolePage
      title={title}
      notice={{
        ok: saved ? `Saved as version ${saved}.` : verified ? `Marked verified.` : undefined,
        error: error ? `${message ?? 'That did not work.'} (${error})` : undefined,
      }}
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

      <form action={markVerifiedAction} className="ops-form-inline">
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <IdemKey />
        <Button variant="ghost">Mark verified now</Button>
        <span className="con-index__blurb">Stamps verifiedAt with the current time and records a content.verified audit event.</span>
      </form>

      <Section title="Edit" id="edit">
        <RecordForm table={table} tableLabel={spec.label} id={id} fields={spec.fields} initial={values} idempotencyKey={newId()} />
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
