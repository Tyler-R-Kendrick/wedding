import Link from 'next/link';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { getContentRecordCapability } from '@/capabilities/get_content_record';
import { newId } from '@/contracts/ids';
import { CONTENT_TABLE_NAMES, TABLE_SPECS, toFormValues } from '@/domain/content/admin';
import { FRESHNESS_LABELS } from '@/domain/content/freshness';
import { ROUTES } from '@/domain/routes';
import { AdminDenied, adminContentContext } from '../../_auth';
import { RecordForm } from '../../_form';
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
    <main id="main" className="ac-main">
      <ul className="ac-crumbs">
        <li>
          <Link href={ROUTES.adminContent}>Content</Link>
        </li>
        <li>
          <Link href={`${ROUTES.adminContent}/${table}`}>{spec.label}</Link>
        </li>
        <li>{title}</li>
      </ul>
      <h1>{title}</h1>
      <p className="ac-muted">
        Version {record.contentVersion} · last edited by {record.editedBy} on <time dateTime={record.updatedAt}>{record.updatedAt.slice(0, 10)}</time> ·{' '}
        <span className={`ac-badge ac-badge--${fresh.tone}`}>{fresh.label}</span> <time dateTime={String(record.values.verifiedAt)}>{String(record.values.verifiedAt).slice(0, 10)}</time>
      </p>
      {saved ? (
        <p className="ac-ok" role="status">
          Saved as version {saved}.
        </p>
      ) : null}
      {verified ? (
        <p className="ac-ok" role="status">
          Marked verified at <time dateTime={verified}>{verified}</time>.
        </p>
      ) : null}
      {error ? (
        <p className="ac-warn" role="alert">
          {message ?? 'That did not work.'} ({error})
        </p>
      ) : null}
      {record.freshness !== 'fresh' ? (
        <div className="ac-warn" role="note">
          <p>
            <strong>{fresh.label}.</strong> Re-check this record against its source
            {record.values.sourceUrl ? (
              <>
                {' '}
                (
                <a href={String(record.values.sourceUrl)} rel="noopener noreferrer" target="_blank">
                  official page
                </a>
                )
              </>
            ) : null}
            , fix anything that changed, then mark it verified.
          </p>
        </div>
      ) : null}

      <form action={markVerifiedAction} className="ac-actions">
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="idempotencyKey" value={newId()} />
        <button className="ac-button ac-button--ghost" type="submit">
          Mark verified now
        </button>
        <span className="ac-muted">Stamps verifiedAt with the current time and records a content.verified audit event.</span>
      </form>

      <h2>Edit</h2>
      <RecordForm table={table} tableLabel={spec.label} id={id} fields={spec.fields} initial={values} idempotencyKey={newId()} />

      <h2>History</h2>
      {record.revisions.length === 0 ? (
        <p className="ac-muted">No previous versions.</p>
      ) : (
        <ul>
          {record.revisions.map((rev) => (
            <li key={rev.contentVersion}>
              v{rev.contentVersion} · {rev.editedBy} · <time dateTime={rev.editedAt}>{rev.editedAt.slice(0, 19).replace('T', ' ')}</time>
              {rev.reason ? ` · ${rev.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
