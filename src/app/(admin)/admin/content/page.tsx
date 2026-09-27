import Link from 'next/link';
import { invoke } from '@/capabilities/invoke';
import { listContentRecordsCapability } from '@/capabilities/list_content_records';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import type { ContentTableName } from '@/db/schema/content';
import { TABLE_SPECS } from '@/domain/content/admin';
import { FRESHNESS_LABELS } from '@/domain/content/freshness';
import { ROUTES } from '@/domain/routes';
import { ConsolePage, DataTable, Day, Denied, Pill, Section } from '../_components/console';
import { AdminDenied, adminContentContext } from './_auth';
import { ContentRecordFlow, MarkVerified } from './_components/ContentFlows';
import { FRESHNESS_TONE, contentEditor, refOptions, visibilityWords, withArticle } from './_components/shared';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Content (admin)' };

/** How many records the attention list shows before it says how many more there are. */
const ATTENTION_LIMIT = 50;

/**
 * Content overview: every table with counts and the records that need attention (stale, expired,
 * placeholder). Adding a record, editing one and marking one verified happen here, in flows and a
 * quick action from the admin kit; each table's own page lists all of its records.
 */
export default async function AdminContentIndex() {
  const { ctx, allowed } = await adminContentContext();
  if (!allowed) return <AdminDenied />;
  const r = await invoke(listContentRecordsCapability, ctx, {});
  // A refused or failed read is shown on the console, not thrown into the error boundary.
  if (!r.ok) {
    return (
      <ConsolePage title="Content">
        <Denied message={r.error.message} />
      </ConsolePage>
    );
  }
  const tables = r.value.data.tables;
  const refs = refOptions(tables);
  const attention = tables.flatMap((t) => t.records.filter((rec) => rec.freshness !== 'fresh' || rec.placeholder).map((rec) => ({ ...rec, table: t.table as ContentTableName, label: t.label })));
  attention.sort((a, b) => order(a.freshness) - order(b.freshness) || b.daysSinceVerified - a.daysSinceVerified);
  const shown = attention.slice(0, ATTENTION_LIMIT);

  return (
    <ConsolePage title="Content" lede="Every record says where its facts come from and when they were last checked. Guests never see drafts or records past their date; the concierge never sees drafts.">
      <Section title="Tables" id="tables">
        <DataTable
          caption="Content tables"
          empty={tables.length === 0 ? <>No content tables are registered.</> : null}
          head={
            <tr>
              <th scope="col">Table</th>
              <th scope="col" className="con-num">Records</th>
              <th scope="col" className="con-num">Need attention</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          }
        >
          {tables.map((t) => {
            const table = t.table as ContentTableName;
            return (
              <tr key={t.table}>
                <th scope="row">
                  <Link href={`${ROUTES.adminContent}/${t.table}`}>{t.label}</Link>
                </th>
                <td className="con-num">{t.count}</td>
                <td className="con-num">{t.needsAttention}</td>
                <td>
                  <ContentRecordFlow editor={contentEditor(table, refs)} label="Add" variant="quiet" accessibleName={`Add ${withArticle(TABLE_SPECS[table].noun)}`} />
                </td>
              </tr>
            );
          })}
        </DataTable>
      </Section>

      <Section title="Records that need attention" id="attention" note={attention.length > ATTENTION_LIMIT ? `The ${ATTENTION_LIMIT} that most need it, of ${attention.length}. Each table’s page lists the rest.` : undefined}>
        <RecordList label="Records that need attention" empty={attention.length === 0 ? 'Everything is checked and written.' : null}>
          {shown.map((rec) => {
            const fresh = FRESHNESS_LABELS[rec.freshness];
            return (
              <RecordRow
                key={`${rec.table}-${rec.id}`}
                data-record-id={rec.id}
                title={<Link href={`${ROUTES.adminContent}/${rec.table}/${rec.id}`}>{rec.title}</Link>}
                status={
                  <>
                    <Pill tone={FRESHNESS_TONE[fresh.tone] ?? 'neutral'}>{fresh.label}</Pill>
                    {rec.placeholder ? <Pill tone="warn">Placeholder</Pill> : null}
                  </>
                }
                meta={
                  <>
                    {rec.label} · {visibilityWords(rec.visibility)} · checked <Day at={rec.verifiedAt} /> ({days(rec.daysSinceVerified)})
                  </>
                }
                actions={
                  <>
                    <ContentRecordFlow editor={contentEditor(rec.table, refs)} record={{ id: rec.id, title: rec.title }} label="Edit" variant="quiet" />
                    <MarkVerified table={rec.table} id={rec.id} title={rec.title} />
                  </>
                }
              />
            );
          })}
        </RecordList>
      </Section>
    </ConsolePage>
  );
}

function order(f: string): number {
  return { expired: 0, stale: 1, not_yet_valid: 2, aging: 3, fresh: 4 }[f] ?? 5;
}

function days(n: number): string {
  if (n <= 0) return 'today';
  return n === 1 ? 'yesterday' : `${n} days ago`;
}
