import type { Metadata } from 'next';
import Link from 'next/link';
import { adminJobsOverview, adminLifecycleStatus } from '@/capabilities/ops';
import { adminInvoke, adminPrincipal } from '../_shared/admin';
import { AdminIndex, ConsoleGate, ConsolePage, Pill, Stat, StatStrip } from './_components/console';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

/**
 * The console home. Two jobs: say what state the site is in right now, and be the one place from
 * which every admin screen is reachable. Both reads are optional — a planner holds
 * `admin_lifecycle` but not `admin_integrations`, so the queue line simply does not appear rather
 * than turning the page into an error.
 */
export default async function AdminPage() {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="This" />;

  const [lifecycle, jobs] = await Promise.all([adminInvoke(adminLifecycleStatus, { historyLimit: 1 }), adminInvoke(adminJobsOverview, { attentionLimit: 1, recentLimit: 1 })]);
  const lc = lifecycle.ok ? lifecycle.value.data : null;
  const jb = jobs.ok ? jobs.value.data : null;
  const dead = jb ? (jb.byStatus.dead ?? 0) : 0;

  return (
    <ConsolePage title="Admin" lede="Everything that runs the site, and the record of what it did.">
      {lc || jb ? (
        <StatStrip>
          {lc ? <Stat label="Lifecycle" value={lc.state} hint={lc.behindSchedule ? `the calendar suggests ${lc.suggested}` : 'matches the calendar'} /> : null}
          {lc ? <Stat label="Published" value={lc.publishedAt ? lc.publishedAt.slice(0, 10) : 'never'} hint={lc.publishedBy ? `by ${lc.publishedBy.kind}` : undefined} /> : null}
          {jb ? <Stat label="Jobs due" value={jb.dueNow} hint={jb.oldestDueAgeSeconds === null ? 'queue empty' : `oldest waiting ${jb.oldestDueAgeSeconds}s`} /> : null}
          {jb ? <Stat label="Dead jobs" value={dead} hint={dead ? 'needs a decision' : 'nothing stuck'} /> : null}
        </StatStrip>
      ) : null}

      {lc?.behindSchedule ? (
        <p className="ops-notice" role="status">
          <Pill tone="warn">Behind schedule</Pill> The calendar has moved past <strong>{lc.state}</strong> to <strong>{lc.suggested}</strong>. Nothing changes until someone publishes it.{' '}
          <Link href="/admin/lifecycle">Review the transition</Link>.
        </p>
      ) : null}

      <p className="con-note">
        Every admin screen in the application. Access is checked server-side on each one; a link you cannot use is still listed, so you know it exists.
      </p>
      <AdminIndex variant="headings" idPrefix="home" />
    </ConsolePage>
  );
}
