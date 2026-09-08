import Link from 'next/link';
import { invoke } from '@/capabilities/invoke';
import { listContentRecordsCapability } from '@/capabilities/list_content_records';
import { FRESHNESS_LABELS } from '@/domain/content/freshness';
import { ROUTES } from '@/domain/routes';
import { ConsolePage, DataTable, Pill, Section, Stamp, type PillTone } from '../_components/console';
import { AdminDenied, adminContentContext } from './_auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Content' };

/** DESIGN.md freshness tones, mapped onto the console's pill tones. */
export const FRESHNESS_TONE: Record<string, PillTone> = { bad: 'bad', warn: 'warn', ok: 'good' };

/** Content overview: every table with counts and the records that need attention (stale, expired, placeholder). */
export default async function AdminContentIndex() {
  const { ctx, allowed } = await adminContentContext();
  if (!allowed) return <AdminDenied />;
  const r = await invoke(listContentRecordsCapability, ctx, {});
  if (!r.ok) throw new Error(r.error.message);
  const attention = r.value.data.tables.flatMap((t) => t.records.filter((rec) => rec.freshness !== 'fresh' || rec.placeholder).map((rec) => ({ ...rec, table: t.table, label: t.label })));
  attention.sort((a, b) => order(a.freshness) - order(b.freshness) || b.daysSinceVerified - a.daysSinceVerified);

  return (
    <ConsolePage title="Content" lede="Every record carries its source, verification date, validity window, and version. Guests never see drafts or expired records; the concierge never sees drafts.">
      <Section title="Tables" id="tables">
        <DataTable
          caption="Content tables"
          empty={r.value.data.tables.length === 0 ? <>No content tables are registered.</> : null}
          head={
            <tr>
              <th scope="col">Table</th>
              <th scope="col" className="con-num">Records</th>
              <th scope="col" className="con-num">Need attention</th>
              <th scope="col">
                <span className="sr-only">Add</span>
              </th>
            </tr>
          }
        >
          {r.value.data.tables.map((t) => (
            <tr key={t.table}>
              <th scope="row">
                <Link href={`${ROUTES.adminContent}/${t.table}`}>{t.label}</Link>
              </th>
              <td className="con-num">{t.count}</td>
              <td className="con-num">{t.needsAttention}</td>
              <td>
                <Link href={`${ROUTES.adminContent}/${t.table}/new`}>New</Link>
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="Stale, expired, or placeholder records" id="attention">
        <DataTable
          caption="Records that need attention"
          empty={attention.length === 0 ? <>Everything is fresh and written.</> : null}
          head={
            <tr>
              <th scope="col">Record</th>
              <th scope="col">Table</th>
              <th scope="col">Freshness</th>
              <th scope="col">Verified</th>
              <th scope="col">Flags</th>
            </tr>
          }
        >
          {attention.slice(0, 50).map((rec) => (
            <tr key={`${rec.table}-${rec.id}`}>
              <th scope="row">
                <Link href={`${ROUTES.adminContent}/${rec.table}/${rec.id}`}>{rec.title}</Link>
              </th>
              <td>{rec.label}</td>
              <td>
                <Pill tone={FRESHNESS_TONE[FRESHNESS_LABELS[rec.freshness].tone] ?? 'neutral'}>{FRESHNESS_LABELS[rec.freshness].label}</Pill>
              </td>
              <td>
                <Stamp at={rec.verifiedAt} /> ({rec.daysSinceVerified} days ago)
              </td>
              <td>
                {rec.placeholder ? 'placeholder ' : ''}
                {rec.visibility !== 'public' ? rec.visibility : ''}
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </ConsolePage>
  );
}

function order(f: string): number {
  return { expired: 0, stale: 1, not_yet_valid: 2, aging: 3, fresh: 4 }[f] ?? 5;
}
