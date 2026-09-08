import type { Metadata } from 'next';
import Link from 'next/link';
import { adminOpsMetrics } from '@/capabilities/ops';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, EmptyRow, Pill, Section, Stat, StatStrip } from '../_components/console';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Metrics', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const WINDOWS = [1, 24, 168, 720];

/**
 * The deployment's own telemetry, and nothing else: counters and histograms written to the
 * `metrics` table (there is no third-party sink, ADR-0008), plus audit volume for the same window.
 *
 * There are no money figures here on purpose. Storage cost is estimated on Media → Storage from
 * bytes actually stored at a stated assumed price; nothing in this repo knows a provider's real
 * rate, and printing one would be a fact nobody agreed to.
 */
export default async function AdminMetricsPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Metrics" />;
  const sp = await searchParams;
  const raw = Array.isArray(sp.window) ? sp.window[0] : sp.window;
  const windowHours = WINDOWS.includes(Number(raw)) ? Number(raw) : 24;

  const result = await adminInvoke(adminOpsMetrics, { windowHours });
  if (!result.ok) {
    return (
      <ConsolePage title="Metrics">
        <Denied message={result.error.message} entitlement="admin_integrations" />
      </ConsolePage>
    );
  }
  const m = result.value.data;

  return (
    <ConsolePage
      title="Metrics"
      lede="What this deployment recorded about itself. No third-party telemetry is sent anywhere."
      actions={
        <nav aria-label="Window">
          <ul className="con-diff">
            {WINDOWS.map((h) => (
              <li key={h}>
                <Link href={`/admin/metrics?window=${h}`} aria-current={h === windowHours ? 'page' : undefined}>
                  {h < 24 ? `${h}h` : `${h / 24}d`}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      }
    >
      {m.recording ? null : (
        <p className="ops-notice" role="status">
          <Pill tone="warn">Not recording</Pill> This deployment has <code className="ops-code">METRICS_SINK={m.sink}</code>, so nothing is written to the table. An empty
          list below means nothing is being recorded, not that nothing happened.
        </p>
      )}

      <StatStrip>
        <Stat label="Window" value={windowHours < 24 ? `${windowHours}h` : `${windowHours / 24}d`} hint={`since ${m.since}`} />
        <Stat label="Points" value={m.totalPoints} hint={`${m.series.length} series`} />
        <Stat label="Audit rows" value={m.audit.total} hint="same window" />
        <Stat label="Denied" value={m.audit.byOutcome.denied ?? 0} hint="authorization refusals" />
        <Stat label="Retention" value={`${m.retentionDays}d`} hint="housekeeping deletes older points" />
      </StatStrip>

      <Section title="Series" id="series" note="Counters report a total; histograms report the distribution. Percentiles are computed in the database over the window, not sampled.">
        <DataTable caption={`Metric series over the last ${windowHours} hours`} head={
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Kind</th>
            <th scope="col" className="con-num">Points</th>
            <th scope="col" className="con-num">Sum</th>
            <th scope="col" className="con-num">p50</th>
            <th scope="col" className="con-num">p95</th>
            <th scope="col" className="con-num">Max</th>
            <th scope="col">Last</th>
          </tr>
        }>
          {m.series.length === 0 ? (
            <EmptyRow span={8}>{m.recording ? 'Nothing was recorded in this window.' : 'Metrics are switched off in this deployment.'}</EmptyRow>
          ) : (
            m.series.map((s) => (
              <tr key={`${s.name}-${s.kind}`}>
                <th scope="row">{s.name}</th>
                <td>{s.kind}</td>
                <td className="con-num">{s.points}</td>
                <td className="con-num">{s.sum}</td>
                <td className="con-num">{s.p50 ?? '—'}</td>
                <td className="con-num">{s.p95 ?? '—'}</td>
                <td className="con-num">{s.max}</td>
                <td>{s.lastAt}</td>
              </tr>
            ))
          )}
        </DataTable>
      </Section>

      <Section title="Audit volume" id="audit" note={<>Counted over the same window. The rows themselves are on <Link href="/admin/audit">the audit trail</Link>.</>}>
        <DataTable caption="Audit rows by action in this window" head={
          <tr>
            <th scope="col">Action</th>
            <th scope="col" className="con-num">Rows</th>
          </tr>
        }>
          {m.audit.topActions.length === 0 ? (
            <EmptyRow span={2}>Nothing was audited in this window.</EmptyRow>
          ) : (
            m.audit.topActions.map((a) => (
              <tr key={a.action}>
                <th scope="row">
                  <Link href={`/admin/audit?action=${encodeURIComponent(a.action)}`}>{a.action}</Link>
                </th>
                <td className="con-num">{a.count}</td>
              </tr>
            ))
          )}
        </DataTable>
      </Section>

      <Section title="What is not here" id="elsewhere">
        <p className="con-note">
          Storage bytes and the labelled cost estimate are on <Link href="/admin/media/metrics">Media → Storage</Link>. Provider modes and health are on{' '}
          <Link href="/admin/providers">Providers</Link>. Queue depth is on <Link href="/admin/jobs">Jobs</Link>. Nothing here invents a price.
        </p>
      </Section>
    </ConsolePage>
  );
}
