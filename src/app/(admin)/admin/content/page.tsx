import Link from 'next/link';
import { invoke } from '@/capabilities/invoke';
import { listContentRecordsCapability } from '@/capabilities/list_content_records';
import { FRESHNESS_LABELS } from '@/domain/content/freshness';
import { ROUTES } from '@/domain/routes';
import { AdminDenied, adminContentContext } from './_auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Content' };

/** Content overview: every table with counts and the records that need attention (stale, expired, placeholder). */
export default async function AdminContentIndex() {
  const { ctx, allowed } = await adminContentContext();
  if (!allowed) return <AdminDenied />;
  const r = await invoke(listContentRecordsCapability, ctx, {});
  if (!r.ok) throw new Error(r.error.message);
  const attention = r.value.data.tables.flatMap((t) => t.records.filter((rec) => rec.freshness !== 'fresh' || rec.placeholder).map((rec) => ({ ...rec, table: t.table, label: t.label })));
  attention.sort((a, b) => order(a.freshness) - order(b.freshness) || b.daysSinceVerified - a.daysSinceVerified);

  return (
    <main id="main" className="ac-main">
      <h1>Content</h1>
      <p className="ac-muted">Every record carries its source, verification date, validity window, and version. Guests never see drafts or expired records; the concierge never sees drafts.</p>

      <h2>Tables</h2>
      <div className="ac-scroll">
        <table className="ac-table">
          <thead>
            <tr>
              <th scope="col">Table</th>
              <th scope="col">Records</th>
              <th scope="col">Need attention</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {r.value.data.tables.map((t) => (
              <tr key={t.table}>
                <th scope="row">
                  <Link href={`${ROUTES.adminContent}/${t.table}`}>{t.label}</Link>
                </th>
                <td>{t.count}</td>
                <td>{t.needsAttention}</td>
                <td>
                  <Link href={`${ROUTES.adminContent}/${t.table}/new`}>New</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Stale, expired, or placeholder records</h2>
      {attention.length === 0 ? (
        <p className="ac-ok">Everything is fresh and written.</p>
      ) : (
        <div className="ac-scroll">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Table</th>
                <th scope="col">Freshness</th>
                <th scope="col">Verified</th>
                <th scope="col">Flags</th>
              </tr>
            </thead>
            <tbody>
              {attention.slice(0, 50).map((rec) => (
                <tr key={`${rec.table}-${rec.id}`}>
                  <th scope="row">
                    <Link href={`${ROUTES.adminContent}/${rec.table}/${rec.id}`}>{rec.title}</Link>
                  </th>
                  <td>{rec.label}</td>
                  <td>
                    <span className={`ac-badge ac-badge--${FRESHNESS_LABELS[rec.freshness].tone}`}>{FRESHNESS_LABELS[rec.freshness].label}</span>
                  </td>
                  <td>
                    <time dateTime={rec.verifiedAt}>{rec.verifiedAt.slice(0, 10)}</time> ({rec.daysSinceVerified} days ago)
                  </td>
                  <td>
                    {rec.placeholder ? 'placeholder ' : ''}
                    {rec.visibility !== 'public' ? rec.visibility : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function order(f: string): number {
  return { expired: 0, stale: 1, not_yet_valid: 2, aging: 3, fresh: 4 }[f] ?? 5;
}
