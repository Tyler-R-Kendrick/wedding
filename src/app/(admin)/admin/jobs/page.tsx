import type { Metadata } from 'next';
import { adminJobsOverview } from '@/capabilities/ops';
import { newId } from '@/contracts/ids';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, Pill, Section, Stamp, Stat, StatStrip } from '../_components/console';
import { cancelJob, retryJob } from '../_lib/ops-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Jobs', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const statusTone = (s: string) => (s === 'dead' || s === 'failed' ? 'bad' : s === 'running' ? 'warn' : s === 'succeeded' ? 'good' : 'neutral');

/**
 * The durable queue. Payloads are deliberately absent: a payload is arbitrary handler input and
 * routinely names a guest, an upload or an asset, and none of that is needed to see that a job is
 * stuck. What is needed is the type, how many attempts it has had, and the last error.
 */
export default async function AdminJobsPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Jobs" />;
  const sp = await searchParams;
  const notice = { ok: one(sp.ok), error: one(sp.error) };

  const result = await adminInvoke(adminJobsOverview, {});
  if (!result.ok) {
    return (
      <ConsolePage title="Jobs" notice={notice}>
        <Denied message={result.error.message} entitlement="admin_integrations" />
      </ConsolePage>
    );
  }
  const j = result.value.data;
  const dead = j.byStatus.dead ?? 0;

  return (
    <ConsolePage
      title="Jobs"
      lede="Background work: retries with backoff, one row per job, claimed optimistically. A runner tick claims from what is queued and due."
      notice={notice}
    >
      <StatStrip>
        <Stat label="Queued" value={j.byStatus.queued ?? 0} hint={`${j.dueNow} due now`} />
        <Stat label="Running" value={j.byStatus.running ?? 0} />
        <Stat label="Dead" value={dead} hint={dead ? 'needs a decision' : 'nothing stuck'} />
        <Stat label="Succeeded" value={j.byStatus.succeeded ?? 0} />
        <Stat label="Oldest due" value={j.oldestDueAgeSeconds === null ? '—' : `${j.oldestDueAgeSeconds}s`} hint="waiting for a runner" />
      </StatStrip>

      <Section
        title="Needs a decision"
        id="attention"
        note="Retrying allows exactly one more attempt and keeps the attempt history. Cancelling applies to a queued job only: a running one is held by a worker."
      >
        <DataTable caption="Failed and dead jobs" head={
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Status</th>
            <th scope="col" className="con-num">Attempts</th>
            <th scope="col">Updated</th>
            <th scope="col">Last error</th>
            <th scope="col">Actions</th>
          </tr>
        } empty={j.attention.length === 0 ? <>No job has failed. Nothing to do here.</> : null}>
          {j.attention.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                {row.type}
                {row.handlerRegistered ? null : <> <Pill tone="bad">no handler</Pill></>}
              </th>
              <td>
                <Pill tone={statusTone(row.status)}>{row.status}</Pill>
              </td>
              <td className="con-num">
                {row.attempts}/{row.maxAttempts}
              </td>
              <td><Stamp at={row.updatedAt} /></td>
              <td className="con-wrap">{row.lastError ?? '—'}</td>
              <td>
                <form action={retryJob} className="con-inline-form">
                  <input type="hidden" name="jobId" value={row.id} />
                  <input type="hidden" name="idem" value={newId()} />
                  <button type="submit" className="ops-button ops-button-ghost">
                    Retry
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="By type" id="types" note="A type with rows but no registered handler can never run in this process — usually a handler that was removed, or a runner started without the module that registers it.">
        <DataTable caption="Jobs by type" head={
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Handler</th>
            <th scope="col" className="con-num">Total</th>
            <th scope="col" className="con-num">Queued</th>
            <th scope="col" className="con-num">Running</th>
            <th scope="col" className="con-num">Succeeded</th>
            <th scope="col" className="con-num">Dead</th>
          </tr>
        } empty={j.byType.length === 0 ? <>No job has ever been enqueued.</> : null}>
          {j.byType.map((t) => (
            <tr key={t.type}>
              <th scope="row">{t.type}</th>
              <td>{t.handlerRegistered ? <Pill tone="good">registered</Pill> : <Pill tone="bad">missing</Pill>}</td>
              <td className="con-num">{t.total}</td>
              <td className="con-num">{t.queued}</td>
              <td className="con-num">{t.running}</td>
              <td className="con-num">{t.succeeded}</td>
              <td className="con-num">{t.dead}</td>
            </tr>
          ))}
        </DataTable>
        {j.idleHandlers.length ? <p className="con-note">Registered but never used: {j.idleHandlers.join(', ')}.</p> : null}
      </Section>

      <Section title="Recent" id="recent" note="The last rows to change, whatever their state — the quickest way to see whether the queue is moving at all.">
        <DataTable caption="Recently updated jobs" head={
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Status</th>
            <th scope="col" className="con-num">Attempts</th>
            <th scope="col">Run at</th>
            <th scope="col">Updated</th>
            <th scope="col">Locked by</th>
            <th scope="col">Actions</th>
          </tr>
        } empty={j.recent.length === 0 ? <>No job has ever been enqueued.</> : null}>
          {j.recent.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.type}</th>
              <td>
                <Pill tone={statusTone(row.status)}>{row.status}</Pill>
              </td>
              <td className="con-num">
                {row.attempts}/{row.maxAttempts}
              </td>
              <td><Stamp at={row.runAt} /></td>
              <td><Stamp at={row.updatedAt} /></td>
              <td className="ops-code">{row.lockedBy ?? '—'}</td>
              <td>
                {row.status === 'queued' ? (
                  <form action={cancelJob} className="con-inline-form">
                    <input type="hidden" name="jobId" value={row.id} />
                    <input type="hidden" name="idem" value={newId()} />
                    <button type="submit" className="ops-button ops-button-danger">
                      Cancel
                    </button>
                  </form>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </ConsolePage>
  );
}
