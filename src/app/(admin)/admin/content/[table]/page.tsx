import Link from 'next/link';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { listContentRecordsCapability } from '@/capabilities/list_content_records';
import { CONTENT_TABLE_NAMES, TABLE_SPECS } from '@/domain/content/admin';
import { FRESHNESS_LABELS } from '@/domain/content/freshness';
import { ROUTES } from '@/domain/routes';
import { AdminDenied, adminContentContext } from '../_auth';

export const dynamic = 'force-dynamic';

type Params = Promise<{ table: string }>;

export default async function AdminContentTable({ params }: { params: Params }) {
  const { table } = await params;
  if (!(CONTENT_TABLE_NAMES as readonly string[]).includes(table)) notFound();
  const spec = TABLE_SPECS[table as keyof typeof TABLE_SPECS];
  const { ctx, allowed } = await adminContentContext();
  if (!allowed) return <AdminDenied />;
  const r = await invoke(listContentRecordsCapability, ctx, { table });
  if (!r.ok) throw new Error(r.error.message);
  const rows = r.value.data.tables[0]?.records ?? [];

  return (
    <main id="main" className="ac-main">
      <ul className="ac-crumbs">
        <li>
          <Link href={ROUTES.adminContent}>Content</Link>
        </li>
        <li>{spec.label}</li>
      </ul>
      <h1>{spec.label}</h1>
      <p>
        <Link href={`${ROUTES.adminContent}/${table}/new`}>New record</Link>
      </p>
      <div className="ac-scroll">
        <table className="ac-table">
          <thead>
            <tr>
              <th scope="col">Record</th>
              <th scope="col">Visibility</th>
              <th scope="col">Freshness</th>
              <th scope="col">Verified</th>
              <th scope="col">Version</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((rec) => (
              <tr key={rec.id}>
                <th scope="row">
                  <Link href={`${ROUTES.adminContent}/${table}/${rec.id}`}>{rec.title}</Link>
                  {rec.placeholder ? <span className="ac-badge"> placeholder</span> : null}
                </th>
                <td>{rec.visibility}</td>
                <td>
                  <span className={`ac-badge ac-badge--${FRESHNESS_LABELS[rec.freshness].tone}`}>{FRESHNESS_LABELS[rec.freshness].label}</span>
                </td>
                <td>
                  <time dateTime={rec.verifiedAt}>{rec.verifiedAt.slice(0, 10)}</time>
                </td>
                <td>v{rec.contentVersion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
