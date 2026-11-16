import type { Metadata } from 'next';
import Link from 'next/link';
import { adminListSessions, adminSessionDetail, adminSiteTraffic } from '@/capabilities/ops';
import { AdminIcon } from '@/components/admin/shell/icons';
import { Chart } from '@/components/admin/viz/Chart';
import '@/components/admin/assistant/assistant.css';
import { shapeTraffic } from '@/domain/admin-assistant';
import { shapeSession, shapeSessions } from '@/domain/admin-assistant/shape';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, Section, Stat, StatStrip, WindowTabs } from '../_components/console';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sessions', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const WINDOWS = [24, 168, 720];

/**
 * Who visited, and what each visit was: one row per session, one click to see it page by page.
 *
 * A session is one tab's visit, recorded by the site itself (`/api/telemetry`): pages opened,
 * errors met, the device class. No IP address, no location, nothing from a third party; a visitor
 * who sends Do Not Track or Global Privacy Control is not recorded here at all.
 */
export default async function AdminSessionsPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Sessions" />;
  const sp = await searchParams;
  const windowHours = WINDOWS.includes(Number(one(sp.window))) ? Number(one(sp.window)) : 168;
  const withErrors = one(sp.errors) === '1';
  const id = one(sp.id);

  const [traffic, list, detail] = await Promise.all([
    adminInvoke(adminSiteTraffic, { windowHours }),
    adminInvoke(adminListSessions, { windowHours, limit: 100, ...(withErrors ? { withErrors: true } : {}) }),
    id && /^[A-Za-z0-9_-]{16,40}$/.test(id) ? adminInvoke(adminSessionDetail, { sessionId: id }) : null,
  ]);
  if (!list.ok || !traffic.ok) {
    return (
      <ConsolePage title="Sessions">
        <Denied message={(list.ok ? (traffic.ok ? null : traffic.error) : list.error)?.message ?? 'Sessions could not be read.'} entitlement="admin_integrations" />
      </ConsolePage>
    );
  }
  const t = shapeTraffic(traffic.value.data);
  const rows = shapeSessions(list.value.data);
  const one_ = detail?.ok ? shapeSession(detail.value.data) : null;
  const keep = { errors: withErrors ? '1' : undefined };

  return (
    <ConsolePage
      title="Sessions"
      lede="One row per visit, recorded by the site itself: pages opened, errors met, the kind of device. No IP address or location is kept, and a visitor who sends Do Not Track is not recorded."
      actions={<WindowTabs path="/admin/sessions" hours={windowHours} params={keep} />}
      wide
    >
      {t.recording ? null : (
        <p className="ops-notice" role="status">
          Visits are not being recorded on this deployment (<code className="ops-code">TELEMETRY=off</code>).
        </p>
      )}

      <StatStrip>
        <Stat label="Sessions" value={t.kpi.sessions} hint={t.delta.sessions ? `${t.delta.sessions.text} on the window before` : undefined} />
        <Stat label="Pages opened" value={t.kpi.pageviews} />
        <Stat label="Guests signed in" value={t.kpi.guests} />
        <Stat label="Typical visit" value={t.kpi.duration} />
        <Stat label="Errors" value={t.kpi.errors} hint={Number(traffic.value.data.totals.erroredSessions) ? `in ${traffic.value.data.totals.erroredSessions} sessions` : undefined} />
      </StatStrip>

      {one_ ? (
        <Section title={`${one_.who}, ${one_.when}`} id="session">
          <p className="con-note">
            {one_.pages} pages in {one_.duration} · {one_.device}. <Link href={`/admin/sessions?window=${windowHours}${withErrors ? '&errors=1' : ''}`}>Close</Link>
          </p>
          <ol className="aui-list aui-list--none aui-list--timeline con-trail">
            {one_.trail.map((e, i) => (
              <li key={i}>
                <div className={e.marker === 'alert' ? 'aui-item aui-item--alert' : 'aui-item'}>
                  <span className="aui-item__marker">{e.marker === 'alert' ? <AdminIcon name="alert" title="Error" /> : e.time}</span>
                  <div className="aui-item__body">
                    <p className="aui-item__title">{e.title}</p>
                    <p className="aui-item__description">{e.marker === 'alert' ? `${e.time} · ${e.description}` : e.description}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      ) : id ? (
        <p className="ops-notice" role="status">
          That session is not on record. It may be older than the retention period.
        </p>
      ) : null}

      {t.empty ? null : (
        <Section title="Over time" id="trend">
          <Chart type="area" data={t.points} x="label" series={['Sessions', 'Pages opened']} height={200} label="Sessions and pages opened over the window" />
        </Section>
      )}

      <Section title={withErrors ? 'Sessions that hit an error' : 'All sessions'} id="sessions">
        <p className="con-filter-links">
          <Link href={`/admin/sessions?window=${windowHours}`} aria-current={withErrors ? undefined : 'true'}>
            All
          </Link>
          <Link href={`/admin/sessions?window=${windowHours}&errors=1`} aria-current={withErrors ? 'true' : undefined}>
            With errors
          </Link>
        </p>
        <DataTable
          caption={rows.caption}
          head={
            <tr>
              <th scope="col">Who</th>
              <th scope="col">Started</th>
              <th scope="col">Time on site</th>
              <th scope="col" className="con-num">Pages</th>
              <th scope="col" className="con-num">Errors</th>
              <th scope="col">Device</th>
              <th scope="col">Came in and left</th>
            </tr>
          }
          empty={rows.rows.length === 0 ? <>{withErrors ? 'No session hit an error in this window.' : 'No visits recorded in this window.'}</> : null}
        >
          {rows.rows.map((r) => (
            <tr key={r.id} aria-current={r.id === id ? 'true' : undefined}>
              <th scope="row">
                <Link href={`/admin/sessions?window=${windowHours}${withErrors ? '&errors=1' : ''}&id=${encodeURIComponent(r.id)}#session`}>{r.who}</Link>
              </th>
              <td>{r.when}</td>
              <td>{r.duration}</td>
              <td className="con-num">{r.pages}</td>
              <td className="con-num">{r.errors}</td>
              <td>{r.device}</td>
              <td>{r.path}</td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="Busiest pages" id="pages">
        <DataTable
          caption="Pages by views in this window"
          head={
            <tr>
              <th scope="col">Page</th>
              <th scope="col" className="con-num">Views</th>
              <th scope="col" className="con-num">Sessions</th>
              <th scope="col" className="con-num">Errors</th>
            </tr>
          }
          empty={t.pages.length === 0 ? <>No pages opened in this window.</> : null}
        >
          {t.pages.map((p) => (
            <tr key={p.path}>
              <th scope="row">{p.path}</th>
              <td className="con-num">{p.views}</td>
              <td className="con-num">{p.sessions}</td>
              <td className="con-num">{p.errors}</td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </ConsolePage>
  );
}
