import type { Metadata } from 'next';
import Link from 'next/link';
import { adminSiteErrors, adminSiteTraffic } from '@/capabilities/ops';
import { Chart } from '@/components/admin/viz/Chart';
import '@/components/admin/assistant/assistant.css';
import { shapeTraffic } from '@/domain/admin-assistant';
import { shapeErrors, stamp } from '@/domain/admin-assistant/shape';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, Pill, Section, Stat, StatStrip, WindowTabs } from '../_components/console';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Errors', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const WINDOWS = [24, 168, 720];

/**
 * What broke for visitors: errors thrown in their browsers and on the server while rendering for
 * them, grouped so one fault seen forty times is one row. Messages are redacted before they are
 * stored (no email addresses, no tokens), and a stack is the top few frames only.
 */
export default async function AdminErrorsPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Errors" />;
  const sp = await searchParams;
  const windowHours = WINDOWS.includes(Number(one(sp.window))) ? Number(one(sp.window)) : 168;

  const [errors, traffic] = await Promise.all([adminInvoke(adminSiteErrors, { windowHours, limit: 50 }), adminInvoke(adminSiteTraffic, { windowHours })]);
  if (!errors.ok) {
    return (
      <ConsolePage title="Errors">
        <Denied message={errors.error.message} entitlement="admin_integrations" />
      </ConsolePage>
    );
  }
  const e = shapeErrors(errors.value.data);
  const t = traffic.ok ? shapeTraffic(traffic.value.data) : null;
  const groups = errors.value.data.groups;

  return (
    <ConsolePage
      title="Errors"
      lede="Errors from visitors’ browsers and from the server while it rendered for them, grouped by fault. Messages are redacted before they are stored."
      actions={<WindowTabs path="/admin/errors" hours={windowHours} />}
      wide
    >
      <StatStrip>
        <Stat label="Errors" value={e.kpi.total} hint={t?.delta.errors ? `${t.delta.errors.text} on the window before` : undefined} />
        <Stat label="Different problems" value={e.kpi.groups} />
        <Stat label="Sessions affected" value={t ? traffic.ok ? traffic.value.data.totals.erroredSessions : 0 : '—'} hint={t ? `of ${t.kpi.sessions}` : undefined} />
      </StatStrip>

      {t && e.total > 0 ? (
        <Section title="Over time" id="trend">
          <Chart type="bar" data={t.points} x="label" series={['Errors']} height={180} label="Errors over the window" />
        </Section>
      ) : null}

      <Section title="Problems" id="problems">
        <DataTable
          caption="Faults in this window, most frequent first"
          head={
            <tr>
              <th scope="col">Problem</th>
              <th scope="col">Where</th>
              <th scope="col">From</th>
              <th scope="col" className="con-num">Seen</th>
              <th scope="col" className="con-num">Sessions</th>
              <th scope="col">First seen</th>
              <th scope="col">Last seen</th>
            </tr>
          }
          empty={groups.length === 0 ? <>Nothing broke for a visitor in this window.</> : null}
        >
          {groups.map((g) => (
            <tr key={g.fingerprint}>
              <th scope="row" className="con-wrap">
                {g.message}
                {g.sample.stack ? (
                  <details className="con-stackbox">
                    <summary>Stack</summary>
                    <pre className="con-stack">{g.sample.stack}</pre>
                  </details>
                ) : null}
                {g.sample.sessionId ? (
                  <Link className="con-cell-link" href={`/admin/sessions?window=${windowHours}&id=${encodeURIComponent(g.sample.sessionId)}#session`}>
                    A session that hit it
                  </Link>
                ) : null}
              </th>
              <td>{g.paths.slice(0, 3).join(', ') || g.sample.path}</td>
              <td>
                <Pill tone={g.source === 'server' ? 'warn' : 'neutral'}>{g.source === 'server' ? 'Server' : 'Browser'}</Pill>
              </td>
              <td className="con-num">{g.count}</td>
              <td className="con-num">{g.sessions}</td>
              <td>{stamp(g.firstAt)}</td>
              <td>{stamp(g.lastAt)}</td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </ConsolePage>
  );
}
