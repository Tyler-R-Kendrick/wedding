import type { Metadata } from 'next';
import Link from 'next/link';
import { adminJobsOverview, adminLifecycleStatus, adminSearchAudit, adminSiteErrors, adminSiteTraffic } from '@/capabilities/ops';
import { adminRsvpOverview } from '@/capabilities/rsvp';
import type { CapabilityDescriptor } from '@/contracts/capability';
import { AdminIcon } from '@/components/admin/shell/icons';
import { Chart } from '@/components/admin/viz/Chart';
import '@/components/admin/assistant/assistant.css';
import { attentionItems, plural, shapeAudit, shapeErrors, shapeJobs, shapeLifecycle, shapeRsvp, shapeTraffic, type Gathered } from '@/domain/admin-assistant';
import type { Delta } from '@/domain/admin-assistant/shape';
import { adminInvoke, adminPrincipal } from '../_shared/admin';
import { ConsoleGate, ConsolePage } from './_components/console';
import { ViewRolePanel } from './_components/ViewRolePanel';
import './_components/overview.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

const ask = (question: string) => `/admin/assistant?q=${encodeURIComponent(question)}`;
const STARTERS = ['Who has not replied?', 'Who visited this week?', 'What errors did guests hit?', 'What is slow?'];

function Figure({ label, value, hint, href, delta, alert }: { label: string; value: string; hint: string; href: string; delta?: Delta; alert?: boolean }) {
  return (
    <Link href={href} className="ov-figure">
      <span className="ov-figure__label">{label}</span>
      <span className="ov-figure__value">
        {value}
        {delta ? <span className={`aui-badge aui-badge--${delta.tone}`}>{delta.text}</span> : null}
      </span>
      <span className={alert ? 'ov-figure__hint ov-figure__hint--alert' : 'ov-figure__hint'}>{hint}</span>
    </Link>
  );
}

/**
 * The console's home: what needs a person today, then how the site is doing, each figure one click
 * from the screen that owns it and one question from the assistant.
 *
 * Every read is optional. A planner holds some entitlements and not others, so a figure or a panel
 * whose capability refuses simply is not drawn; the page never turns into an error because one of
 * six reads said no. The reads are the same capabilities the screens use, through the pipeline.
 */
export default async function AdminPage() {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="This" />;

  const read = async <I, O>(capability: CapabilityDescriptor<I, O>, input: unknown): Promise<O | null> => {
    const result = await adminInvoke(capability, input);
    return result.ok ? result.value.data : null;
  };
  const [lifecycle, jobs, rsvp, errors, traffic, audit] = await Promise.all([
    read(adminLifecycleStatus, { historyLimit: 1 }),
    read(adminJobsOverview, { attentionLimit: 5, recentLimit: 1 }),
    read(adminRsvpOverview, {}),
    read(adminSiteErrors, { windowHours: 168 }),
    read(adminSiteTraffic, { windowHours: 168 }),
    read(adminSearchAudit, { limit: 60 }),
  ]);

  const gathered: Gathered = { now: new Date().toISOString(), lifecycle, jobs, rsvp, errors, traffic };
  const items = attentionItems(gathered);
  const open = items.filter((i) => i.state !== 'done');
  const fine = items.filter((i) => i.state === 'done');

  const lc = lifecycle ? shapeLifecycle(lifecycle) : null;
  const rv = rsvp ? shapeRsvp(rsvp) : null;
  const tr = traffic ? shapeTraffic(traffic) : null;
  const er = errors ? shapeErrors(errors) : null;
  const jb = jobs ? shapeJobs(jobs) : null;
  // What changed, not what was looked at: every read is audited too, and this page alone makes six.
  const changes = audit ? { ...audit, rows: audit.rows.filter((r) => r.metadata?.kind !== 'read' && r.metadata?.kind !== 'navigate').slice(0, 7) } : null;
  const au = changes ? shapeAudit(changes) : null;

  return (
    <ConsolePage title="Overview" wide>
      <form action="/admin/assistant" method="get" className="ov-ask" role="search">
        <label htmlFor="ov-q" className="ov-ask__label">
          Ask the console
        </label>
        <div className="ov-ask__row">
          <AdminIcon name="ask" />
          <input id="ov-q" name="q" type="text" className="ov-ask__field" maxLength={500} autoComplete="off" required />
          <button type="submit" className="ov-ask__send" aria-label="Ask">
            <AdminIcon name="send" />
          </button>
        </div>
        <ul className="ov-ask__starters">
          {STARTERS.map((q) => (
            <li key={q}>
              <Link href={ask(q)}>{q}</Link>
            </li>
          ))}
        </ul>
      </form>

      <div className="ov-figures">
        {lc ? <Figure label="Guests see" value={lc.stateLabel} hint={lc.behind ? `Calendar suggests ${lc.suggestedLabel}` : 'Matches the calendar'} href="/admin/lifecycle" alert={lc.behind} /> : null}
        {rv ? <Figure label="Replied" value={`${rv.replied} of ${rv.invited}`} hint={rv.invited ? `${rv.percent}% · ${rv.waiting} waiting` : 'Nobody invited yet'} href="/admin/rsvp" /> : null}
        {tr ? <Figure label="Visits, 7 days" value={tr.kpi.sessions} delta={tr.delta.sessions} hint={tr.recording ? `${plural(traffic!.totals.guests, 'guest')} signed in` : 'Not recording'} href="/admin/sessions" /> : null}
        {er ? <Figure label="Errors, 7 days" value={er.kpi.total} delta={tr?.delta.errors} hint={er.total ? plural(er.groups, 'different problem') : 'Nothing broke'} href="/admin/errors" alert={er.total > 0} /> : null}
        {jb ? <Figure label="Jobs stuck" value={jb.kpi.dead} hint={jb.due ? `${plural(jb.due, 'job')} due now` : 'Queue empty'} href="/admin/jobs" alert={jb.dead > 0} /> : null}
      </div>

      <div className="ov-grid">
        <section className="ov-panel ov-panel--needs" aria-labelledby="ov-needs">
          <h2 id="ov-needs" className="ov-panel__title">
            {open.length ? 'Needs you' : 'Nothing is waiting on you'}
          </h2>
          {open.length ? (
            <ul className="ov-needs">
              {open.map((item) => (
                <li key={item.title} className={`ov-need ov-need--${item.state}`}>
                  <AdminIcon name={item.state === 'alert' ? 'alert' : 'arrow'} className="ov-need__mark" />
                  <div>
                    <p className="ov-need__title">{item.title}</p>
                    <p className="ov-need__detail">{item.detail}</p>
                    <p className="ov-need__acts">
                      {item.act && 'publish' in item.act ? <Link href={ask(`Publish ${lc?.suggestedLabel ?? 'the next state'}`)}>Review and publish</Link> : item.act ? <Link href={ask(item.act.ask)}>{item.act.ask}</Link> : null}
                      <Link href={item.href}>Open the screen</Link>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {fine.length ? (
            <ul className="ov-fine">
              {fine.map((item) => (
                <li key={item.title}>
                  <AdminIcon name="check" />
                  <Link href={item.href}>{item.title}</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {tr ? (
          <section className="ov-panel" aria-labelledby="ov-visits">
            <div className="ov-panel__head">
              <h2 id="ov-visits" className="ov-panel__title">
                Visits, last 7 days
              </h2>
              <Link href="/admin/sessions">Sessions</Link>
            </div>
            {tr.empty ? <p className="aui-empty">{tr.recording ? 'No visits recorded yet.' : 'Visits are not being recorded on this deployment.'}</p> : <Chart type="area" data={tr.points} x="label" series={['Sessions', 'Pages opened']} height={200} label="Sessions and pages opened per day, last 7 days" />}
          </section>
        ) : null}

        {rv && rv.bars.length ? (
          <section className="ov-panel" aria-labelledby="ov-replies">
            <div className="ov-panel__head">
              <h2 id="ov-replies" className="ov-panel__title">
                Replies by event
              </h2>
              <Link href="/admin/rsvp">RSVPs</Link>
            </div>
            <Chart type="bar" data={rv.bars} x="event" series={['Coming', 'Not coming', 'No answer yet']} stacked height={200} label="Replies by event" />
          </section>
        ) : null}

        {tr && tr.pages.length ? (
          <section className="ov-panel" aria-labelledby="ov-pages">
            <div className="ov-panel__head">
              <h2 id="ov-pages" className="ov-panel__title">
                Busiest pages
              </h2>
              <Link href={ask('How many visits this week?')}>More</Link>
            </div>
            <table className="aui-table ov-pages">
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col" className="aui-num">
                    Views
                  </th>
                  <th scope="col" className="aui-num">
                    Errors
                  </th>
                </tr>
              </thead>
              <tbody>
                {tr.pages.slice(0, 6).map((p) => (
                  <tr key={p.path}>
                    <td>{p.path}</td>
                    <td className="aui-num">{p.views}</td>
                    <td className="aui-num">{p.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {au && au.rows.length ? (
          <section className="ov-panel" aria-labelledby="ov-activity">
            <div className="ov-panel__head">
              <h2 id="ov-activity" className="ov-panel__title">
                Recent changes
              </h2>
              <Link href="/admin/audit">Audit trail</Link>
            </div>
            <ul className="ov-activity">
              {au.rows.map((r, i) => (
                <li key={i}>
                  <span className="ov-activity__when">{r.when}</span>
                  <span>
                    {r.who}: {r.target}
                  </span>
                  {r.outcome === 'Done' ? null : <span className={`aui-badge aui-badge--${r.tone}`}>{r.outcome}</span>}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <ViewRolePanel />
    </ConsolePage>
  );
}
