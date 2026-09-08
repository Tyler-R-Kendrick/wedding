import Link from 'next/link';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { listContentRecordsCapability } from '@/capabilities/list_content_records';
import { CONTENT_TABLE_NAMES, TABLE_SPECS } from '@/domain/content/admin';
import { FRESHNESS_LABELS } from '@/domain/content/freshness';
import { ROUTES } from '@/domain/routes';
import { Breadcrumbs, ConsolePage, DataTable, Pill, Stamp } from '../../_components/console';
import { AdminDenied, adminContentContext } from '../_auth';
import { FRESHNESS_TONE } from '../page';

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
    <ConsolePage
      title={spec.label}
      actions={
        <Link className="ops-button ops-button-ghost" href={`${ROUTES.adminContent}/${table}/new`}>
          New record
        </Link>
      }
    >
      <Breadcrumbs trail={[{ href: ROUTES.adminContent, label: 'Content' }, { label: spec.label }]} />
      <DataTable
        caption={`${spec.label} records`}
        empty={rows.length === 0 ? <>Nothing in this table yet.</> : null}
        head={
          <tr>
            <th scope="col">Record</th>
            <th scope="col">Visibility</th>
            <th scope="col">Freshness</th>
            <th scope="col">Verified</th>
            <th scope="col">Version</th>
          </tr>
        }
      >
        {rows.map((rec) => (
          <tr key={rec.id}>
            <th scope="row">
              <Link href={`${ROUTES.adminContent}/${table}/${rec.id}`}>{rec.title}</Link>
              {rec.placeholder ? <Pill tone="warn">placeholder</Pill> : null}
            </th>
            <td>{rec.visibility}</td>
            <td>
              <Pill tone={FRESHNESS_TONE[FRESHNESS_LABELS[rec.freshness].tone] ?? 'neutral'}>{FRESHNESS_LABELS[rec.freshness].label}</Pill>
            </td>
            <td>
              <Stamp at={rec.verifiedAt} />
            </td>
            <td className="con-num">v{rec.contentVersion}</td>
          </tr>
        ))}
      </DataTable>
    </ConsolePage>
  );
}
