import type { Metadata } from 'next';
import Link from 'next/link';
import { adminSearchAudit } from '@/capabilities/ops';
import { AUDIT_ACTIONS, type AuditAction } from '@/contracts/audit';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, Pill, Section, Stamp, Stat, StatStrip } from '../_components/console';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Audit trail', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length ? s : undefined;
};

const OUTCOMES = ['success', 'denied', 'failed'] as const;
const ACTOR_KINDS = ['guest', 'admin', 'system', 'anonymous'] as const;
const isAction = (v: string): v is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(v);
const tone = (outcome: string) => (outcome === 'denied' ? 'warn' : outcome === 'failed' ? 'bad' : 'good');

/**
 * The read side of the audit trail: twenty-one admin capabilities and every capability invocation
 * write rows here, and until this level nothing could read them without a database prompt.
 *
 * Metadata is redacted on write and again on read, and the values of free-text keys are withheld:
 * this page is readable by `admin_audit`, which a moderator holds without `admin_guest_ops`, and it
 * must not become the one place a guest's dietary note or a revoked invitation's reason can be read.
 */
export default async function AdminAuditPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="The audit trail" />;
  const sp = await searchParams;

  const action = one(sp.action);
  const outcome = one(sp.outcome);
  const filters = {
    actions: action && isAction(action) ? [action] : undefined,
    outcome: outcome && (OUTCOMES as readonly string[]).includes(outcome) ? (outcome as (typeof OUTCOMES)[number]) : undefined,
    targetType: one(sp.targetType),
    targetId: one(sp.targetId),
    requestId: one(sp.requestId),
    actorKind: (ACTOR_KINDS as readonly string[]).includes(one(sp.actorKind) ?? '') ? (one(sp.actorKind) as (typeof ACTOR_KINDS)[number]) : undefined,
    limit: Number(one(sp.limit) ?? 50) || 50,
    cursor: one(sp.cursorAt) && one(sp.cursorId) ? { at: one(sp.cursorAt)!, id: one(sp.cursorId)! } : undefined,
  };

  const result = await adminInvoke(adminSearchAudit, filters);
  if (!result.ok) {
    return (
      <ConsolePage title="Audit trail">
        <Denied message={result.error.message} entitlement="admin_audit" />
      </ConsolePage>
    );
  }
  const data = result.value.data;
  const nextHref = data.nextCursor
    ? `/admin/audit?${new URLSearchParams({
        ...(action ? { action } : {}),
        ...(outcome ? { outcome } : {}),
        ...(filters.targetType ? { targetType: filters.targetType } : {}),
        ...(filters.targetId ? { targetId: filters.targetId } : {}),
        ...(filters.requestId ? { requestId: filters.requestId } : {}),
        ...(filters.actorKind ? { actorKind: filters.actorKind } : {}),
        cursorAt: data.nextCursor.at,
        cursorId: data.nextCursor.id,
      }).toString()}`
    : null;

  return (
    <ConsolePage
      title="Audit trail"
      lede="Append-only. Every capability invocation and every domain event, newest first."
    >
      <StatStrip>
        <Stat label="Rows, all time" value={data.window.total} />
        <Stat label="Succeeded" value={data.window.byOutcome.success ?? 0} />
        <Stat label="Denied" value={data.window.byOutcome.denied ?? 0} hint="authorization refused" />
        <Stat label="Failed" value={data.window.byOutcome.failed ?? 0} hint="handler error" />
      </StatStrip>

      <Section title="Filter" id="filter" note="Filters are applied server-side inside the capability; nothing is fetched to the browser and narrowed there.">
        <form method="get" className="con-form">
          <div className="ops-field">
            <label htmlFor="f-action">Action</label>
            <select id="f-action" name="action" className="ops-input" defaultValue={action ?? ''}>
              <option value="">Any action</option>
              {[...AUDIT_ACTIONS].sort().map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="ops-field">
            <label htmlFor="f-outcome">Outcome</label>
            <select id="f-outcome" name="outcome" className="ops-input" defaultValue={outcome ?? ''}>
              <option value="">Any outcome</option>
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="ops-field">
            <label htmlFor="f-actor">Actor</label>
            <select id="f-actor" name="actorKind" className="ops-input" defaultValue={filters.actorKind ?? ''}>
              <option value="">Anyone</option>
              {ACTOR_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="ops-field">
            <label htmlFor="f-target-type">Target type</label>
            <input id="f-target-type" name="targetType" type="text" className="ops-input" defaultValue={filters.targetType ?? ''} maxLength={64} />
          </div>
          <div className="ops-field">
            <label htmlFor="f-target-id">Target id</label>
            <input id="f-target-id" name="targetId" type="text" className="ops-input" defaultValue={filters.targetId ?? ''} maxLength={80} />
          </div>
          <div className="ops-field">
            <label htmlFor="f-request">Request id</label>
            <input id="f-request" name="requestId" type="text" className="ops-input" defaultValue={filters.requestId ?? ''} maxLength={80} />
          </div>
          <button type="submit" className="ops-button ops-button-ghost">
            Search
          </button>
          <p className="ops-field">
            <Link href="/admin/audit">Clear filters</Link>
          </p>
        </form>
      </Section>

      {/*
        Level-14 review, should-fix: at 390 this was "25 undifferentiated `capability.invoked` rows
        with `k=v · k=v` detail soup". Three changes, and none of them removes a column:

        1. The SUBJECT leads. Every row's second column said `capability.invoked`, and what actually
           told two rows apart — `admin_media_metrics` vs `list_ai_traces` — was column five, off
           the right edge of a phone. The target is now the row header, first, which is also what
           every other table in this console uses `<th scope="row">` for and what a screen reader
           announces before each cell.
        2. The detail is a real key/value list instead of one joined string. `kind=read · surface=ui
           · durationMs=17` is three facts pretending to be a sentence.
        3. Cells carry `data-col`, so a test asserts on the COLUMN it means rather than on an index
           that silently follows a reordering. tests/e2e/admin-console.spec.ts uses them.
      */}
      <Section title="Events" id="events" note="Metadata is redacted when it is written and again when it is read; keys carrying free text show as withheld rather than being reprinted here.">
        <DataTable caption="Audit events, newest first" head={
          <tr>
            <th scope="col">Subject</th>
            <th scope="col">When</th>
            <th scope="col">Action</th>
            <th scope="col">Outcome</th>
            <th scope="col">Actor</th>
            <th scope="col">Detail</th>
            <th scope="col">Request</th>
          </tr>
        } empty={data.rows.length === 0 ? <>No audit events match this filter.</> : null}>
          {data.rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" data-col="target">
                <span className="con-subject">{r.targetId}</span>
                <span className="con-index__blurb">{r.targetType}</span>
              </th>
              <td data-col="at">
                <Stamp at={r.at} />
              </td>
              <td data-col="action">{r.action}</td>
              <td data-col="outcome">
                <Pill tone={tone(r.outcome)}>{r.outcome}</Pill>
              </td>
              <td data-col="actor">
                {r.actor.kind}
                {r.actor.ref ? <span className="ops-code"> {r.actor.ref}</span> : null}
              </td>
              <td className="con-wrap" data-col="detail">
                {r.metadata && Object.keys(r.metadata).length ? (
                  <dl className="con-detail">
                    {Object.entries(r.metadata).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  '—'
                )}
                {r.metadataRedacted ? <span className="con-index__blurb">some values withheld</span> : null}
              </td>
              <td className="ops-code" data-col="request">{r.requestId}</td>
            </tr>
          ))}
        </DataTable>
        {nextHref ? (
          <p>
            <Link href={nextHref}>Older events →</Link>
          </p>
        ) : null}
      </Section>

      <Section title="Busiest actions" id="totals" note="All time, whatever the filter above says.">
        <DataTable caption="Audit rows by action" head={
          <tr>
            <th scope="col">Action</th>
            <th scope="col" className="con-num">
              Rows
            </th>
          </tr>
        } empty={data.window.topActions.length === 0 ? <>Nothing has been audited yet.</> : null}>
          {data.window.topActions.map((a) => (
            <tr key={a.action}>
              <th scope="row">
                <Link href={`/admin/audit?action=${encodeURIComponent(a.action)}`}>{a.action}</Link>
              </th>
              <td className="con-num">{a.count}</td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </ConsolePage>
  );
}
