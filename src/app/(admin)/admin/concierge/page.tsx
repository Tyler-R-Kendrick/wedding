import 'server-only';
import type { Metadata } from 'next';
import type { AiTracesData } from '@/capabilities/list_ai_traces';
import { FilterBar, RecordList, RecordRow } from '@/components/admin/flow/records';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { AI_ANSWER_STATUSES } from '@/db/schema/ai';
import { ConsoleGate, ConsolePage, DataTable, Day, Note, Pill, Section, Stamp, Stat, StatStrip, SubNav, formatStamp, type PillTone } from '../_components/console';
import { Input } from '../_components/ops';
import { INTELLIGENCE_SUBNAV } from '../_components/sections';
import './concierge.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Concierge traces', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Status = (typeof AI_ANSWER_STATUSES)[number];

const STATUS: Record<Status, { label: string; tone: PillTone }> = {
  grounded: { label: 'Fully grounded', tone: 'good' },
  partial: { label: 'Partly grounded', tone: 'warn' },
  refused: { label: 'Refused', tone: 'bad' },
  confirmation: { label: 'Asked to confirm', tone: 'neutral' },
  error: { label: 'Error', tone: 'bad' },
};

/** Who asked, and where a cited source came from, in words; the codes stay under "How it answered". */
const ASKED_BY: Record<string, string> = { guest: 'a guest', admin: 'an admin', anonymous: 'a visitor' };
const TRUST: Record<string, string> = { TRUSTED_WEDDING: 'the wedding’s own pages', EXTERNAL_DATA: 'outside data', UNTRUSTED_USER_CONTENT: 'written by a guest' };

const nav = <SubNav label="Media and AI" items={INTELLIGENCE_SUBNAV.map((i) => ({ ...i, current: i.href === '/admin/concierge' }))} />;

/**
 * What the concierge was asked, what it actually said, and why (swarm J).
 *
 * Everything on this page comes from `list_ai_traces` through `invoke`, so the entitlement check is
 * the same one the API does; rendering behind an admin gate is UX minimisation, not authorization.
 * Questions and answers are stored PII-redacted and truncated, and there is no private
 * chain-of-thought to show because none is ever stored (ADR-0003).
 *
 * It lives at /admin/concierge, not /admin/ai: level 11 already owns /admin/ai for the media search
 * index, and two unrelated features cannot share one URL.
 *
 * Read-only, laid out by the console conventions: headline numbers, the two alert logs as
 * `DataTable`s, a `FilterBar` over the answers (the capability filters by verdict), each answer a
 * `RecordRow`, and what it called — capabilities, timings, request ids — closed under each one.
 */
export default async function AdminConciergePage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Concierge traces" />;
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status = AI_ANSWER_STATUSES.includes(raw as Status) ? (raw as Status) : undefined;
  const traces = await invokeForRequest<AiTracesData>('list_ai_traces', { limit: 50, ...(status ? { status } : {}) }, principal);
  if (!traces.ok) {
    return (
      <ConsolePage title="Concierge" subNav={nav}>
        <Section id="error">
          <Note>{traces.error.message}</Note>
        </Section>
      </ConsolePage>
    );
  }
  const { answers, groundingFailures, securityAlerts, totals } = traces.data;

  return (
    <ConsolePage
      title="Concierge"
      lede="Every answer the concierge gave, with the verdict its verifier reached, the sources it cited and the capabilities it called. Questions and answers are redacted and expire with their session. No reasoning is stored, so there is none to show."
      subNav={nav}
    >
      <StatStrip>
        <Stat label="Answers" value={totals.answers} />
        <Stat label="Fully grounded" value={totals.grounded} />
        <Stat label="Partial" value={totals.partial} />
        <Stat label="Refused" value={totals.refused} />
      </StatStrip>

      <Section id="alerts" title="Security alerts">
        <DataTable
          caption="Prompt-injection attempts, newest first"
          head={
            <tr>
              <th scope="col">When</th>
              <th scope="col">Where</th>
              <th scope="col">Rules matched</th>
              <th scope="col">Answer</th>
            </tr>
          }
          empty={securityAlerts.length === 0 ? <>No prompt-injection attempts have been recorded.</> : null}
        >
          {securityAlerts.map((alert) => (
            <tr key={alert.id}>
              <td>
                <Stamp at={alert.at} />
              </td>
              <td>{String(alert.metadata?.kind ?? 'source')}</td>
              <td className="con-wrap">{String(alert.metadata?.rules ?? '')}</td>
              <td className="ops-code">{alert.answerId}</td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section id="grounding" title="Grounding failures">
        <DataTable
          caption="Answers where a claim was dropped, newest first"
          head={
            <tr>
              <th scope="col">When</th>
              <th scope="col">Intent</th>
              <th scope="col" className="con-num">Claims</th>
              <th scope="col" className="con-num">Dropped</th>
              <th scope="col">Reasons</th>
            </tr>
          }
          empty={groundingFailures.length === 0 ? <>Every claim the model made was supported by the source it cited.</> : null}
        >
          {groundingFailures.map((failure) => (
            <tr key={failure.id}>
              <td>
                <Stamp at={failure.at} />
              </td>
              <td>{String(failure.metadata?.intent ?? '')}</td>
              <td className="con-num">{String(failure.metadata?.claims ?? '')}</td>
              <td className="con-num">{String(failure.metadata?.dropped ?? '')}</td>
              <td className="con-wrap">{String(failure.metadata?.reasons ?? '')}</td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section id="answers" title="Answers">
        <FilterBar submitLabel="Show" extra={status ? <a className="flow-link" href="/admin/concierge">Show every answer</a> : null}>
          <Input id="status" label="Verdict" defaultValue={status ?? ''} options={[{ value: '', label: 'Any verdict' }, ...AI_ANSWER_STATUSES.map((s) => ({ value: s, label: STATUS[s].label }))]} />
        </FilterBar>
        <RecordList label="Concierge answers" empty={answers.length === 0 ? (status ? `No answer has the verdict “${STATUS[status].label}”.` : 'Nobody has asked the concierge anything yet.') : null}>
          {answers.map((answer) => (
            <RecordRow
              key={answer.id}
              data-answer-id={answer.id}
              data-status={answer.status}
              title={answer.question}
              status={
                <>
                  <Pill tone={STATUS[answer.status].tone}>{STATUS[answer.status].label}</Pill>
                  {answer.securityAlerts > 0 ? <Pill tone="bad">{answer.securityAlerts} security alerts</Pill> : null}
                </>
              }
              meta={
                <>
                  <Stamp at={answer.createdAt} /> · asked by {ASKED_BY[answer.principalKind] ?? 'someone else'} · {answer.verifier.supported} of {answer.verifier.claims} claims kept
                </>
              }
            >
              <p className="cg-answer">{answer.answer}</p>
              {answer.verifier.reasons.length > 0 ? <p className="cg-dropped">Dropped because: {answer.verifier.reasons.join(', ')}.</p> : null}
              {answer.sources.length > 0 ? (
                <ol className="cg-sources">
                  {answer.sources.map((source) => (
                    <li key={`${answer.id}-${source.marker}`}>
                      [{source.marker}] {source.url ? <a href={source.url}>{source.title}</a> : source.title} · {TRUST[source.trustClass] ?? 'source unclassified'}
                      {source.verifiedAt ? (
                        <>
                          {' '}
                          · checked <Day at={source.verifiedAt} />
                        </>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              <details className="flow-details cg-details">
                <summary>How it answered</summary>
                <div className="flow-details__body">
                  <p className="flow-row__meta">
                    Intent <span className="ops-code">{answer.intent}</span> · model {answer.modelId} · {answer.latencyMs} ms · verifier {answer.verifier.method} · request <span className="ops-code">{answer.requestId}</span>
                  </p>
                  {answer.invocations.length > 0 ? (
                    <DataTable
                      caption="Capabilities it called"
                      head={
                        <tr>
                          <th scope="col">Capability</th>
                          <th scope="col">Kind</th>
                          <th scope="col">Chosen by</th>
                          <th scope="col">Outcome</th>
                          <th scope="col">Error</th>
                          <th scope="col" className="con-num">Chars</th>
                          <th scope="col" className="con-num">ms</th>
                        </tr>
                      }
                    >
                      {answer.invocations.map((invocation, index) => (
                        <tr key={`${answer.id}-${invocation.capability}-${index}`}>
                          <th scope="row">{invocation.capability}</th>
                          <td>{invocation.kind}</td>
                          <td>{invocation.selectedBy}</td>
                          <td>{invocation.outcome}</td>
                          <td>{invocation.errorCode ?? ''}</td>
                          <td className="con-num">{invocation.outputChars}</td>
                          <td className="con-num">{invocation.durationMs}</td>
                        </tr>
                      ))}
                    </DataTable>
                  ) : (
                    <p className="flow-row__meta">It called no capabilities.</p>
                  )}
                  {answer.sources.some((s) => s.retrievedAt) ? (
                    <p className="flow-row__meta">
                      Sources retrieved:{' '}
                      {answer.sources
                        .filter((s) => s.retrievedAt)
                        .map((s) => `[${s.marker}] ${formatStamp(s.retrievedAt)}`)
                        .join(' · ')}
                    </p>
                  ) : null}
                </div>
              </details>
            </RecordRow>
          ))}
        </RecordList>
      </Section>
    </ConsolePage>
  );
}
