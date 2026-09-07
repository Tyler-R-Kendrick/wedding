import 'server-only';
import type { Metadata } from 'next';
import type { AiTracesData } from '@/capabilities/list_ai_traces';
import { AdminGate } from '@/components/media/AdminMediaNav';
import { MediaEmpty, MediaPage, MediaSection } from '@/components/media/MediaShell';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { AdminAiNav } from '@/components/mediaai/AdminAiNav';
import { ScrollableTable } from '@/components/mediaai/ScrollableTable';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Concierge traces', robots: { index: false, follow: false } };

const stamp = (iso: string) => iso.replace('T', ' ').slice(0, 16);

/**
 * What the concierge was asked, what it actually said, and why (swarm J).
 *
 * Everything on this page comes from `list_ai_traces` through `invoke`, so the entitlement check is
 * the same one the API does; rendering behind an admin gate is UX minimisation, not authorization.
 * Questions and answers are stored PII-redacted and truncated, and there is no private
 * chain-of-thought to show because none is ever stored (ADR-0003).
 *
 * It lives at /admin/concierge, not /admin/ai: level 11 already owns /admin/ai for the media search
 * index, and two unrelated features cannot share one URL. The nav tab is the third in AdminAiNav.
 */
export default async function AdminConciergePage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin') return <AdminGate />;
  const traces = await invokeForRequest<AiTracesData>('list_ai_traces', { limit: 50 }, principal);
  if (!traces.ok) {
    return (
      <MediaPage title="Concierge" actions={<AdminAiNav current="concierge" />}>
        <MediaSection id="error">
          <p className="media-lede">{traces.error.message}</p>
        </MediaSection>
      </MediaPage>
    );
  }
  const { answers, groundingFailures, securityAlerts, totals } = traces.data;

  return (
    <MediaPage
      title="Concierge"
      lede="Every answer the concierge gave, with the verdict its verifier reached, the sources it cited and the capabilities it called. Questions and answers are redacted and expire with their session. No reasoning is stored, so there is none to show."
      actions={<AdminAiNav current="concierge" />}
    >
      <MediaSection id="totals" title="Totals">
        <ul className="ai-totals">
          <li>
            <b>{totals.answers}</b> answers
          </li>
          <li>
            <b>{totals.grounded}</b> fully grounded
          </li>
          <li>
            <b>{totals.partial}</b> partial
          </li>
          <li>
            <b>{totals.refused}</b> refused
          </li>
        </ul>
      </MediaSection>

      <MediaSection id="alerts" title="Security alerts">
        {securityAlerts.length === 0 ? (
          <MediaEmpty>No prompt-injection attempts have been recorded.</MediaEmpty>
        ) : (
          <ScrollableTable label="Security alerts">
            <table className="mi-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Where</th>
                  <th scope="col">Rules matched</th>
                  <th scope="col">Answer</th>
                </tr>
              </thead>
              <tbody>
                {securityAlerts.map((alert) => (
                  <tr key={alert.id}>
                    <td>
                      <time dateTime={alert.at}>{stamp(alert.at)}</time>
                    </td>
                    <td>{String(alert.metadata?.kind ?? 'source')}</td>
                    <td>{String(alert.metadata?.rules ?? '')}</td>
                    <td>{alert.answerId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </MediaSection>

      <MediaSection id="grounding" title="Grounding failures">
        {groundingFailures.length === 0 ? (
          <MediaEmpty>Every claim the model made was supported by the source it cited.</MediaEmpty>
        ) : (
          <ScrollableTable label="Grounding failures">
            <table className="mi-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Intent</th>
                  <th scope="col">Claims</th>
                  <th scope="col">Dropped</th>
                  <th scope="col">Reasons</th>
                </tr>
              </thead>
              <tbody>
                {groundingFailures.map((failure) => (
                  <tr key={failure.id}>
                    <td>
                      <time dateTime={failure.at}>{stamp(failure.at)}</time>
                    </td>
                    <td>{String(failure.metadata?.intent ?? '')}</td>
                    <td>{String(failure.metadata?.claims ?? '')}</td>
                    <td>{String(failure.metadata?.dropped ?? '')}</td>
                    <td>{String(failure.metadata?.reasons ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </MediaSection>

      <MediaSection id="answers" title="Answers">
        {answers.length === 0 ? (
          <MediaEmpty>Nobody has asked the concierge anything yet.</MediaEmpty>
        ) : (
          answers.map((answer) => (
            <article key={answer.id} className="mi-panel ai-answer" data-status={answer.status} aria-labelledby={`a-${answer.id}`}>
              <h3 id={`a-${answer.id}`}>{answer.question}</h3>
              <ul className="ai-tags">
                <li>{answer.status}</li>
                <li>{answer.intent}</li>
                <li>{answer.principalKind}</li>
                <li>{answer.modelId}</li>
                <li>{answer.latencyMs} ms</li>
                <li className={answer.verifier.dropped > 0 ? 'is-bad' : ''}>
                  {answer.verifier.supported}/{answer.verifier.claims} claims kept
                </li>
                {answer.securityAlerts > 0 ? <li className="is-bad">{answer.securityAlerts} security alerts</li> : null}
              </ul>
              <p>{answer.answer}</p>
              {answer.verifier.reasons.length > 0 ? <p className="media-lede">Dropped because: {answer.verifier.reasons.join(', ')}.</p> : null}
              {answer.sources.length > 0 ? (
                <ol className="ai-sources">
                  {answer.sources.map((source) => (
                    <li key={`${answer.id}-${source.marker}`}>
                      [{source.marker}] {source.url ? <a href={source.url}>{source.title}</a> : source.title} · {source.trustClass}
                      {source.verifiedAt ? ` · checked ${source.verifiedAt.slice(0, 10)}` : ''}
                      {source.retrievedAt ? ` · retrieved ${stamp(source.retrievedAt)}` : ''}
                    </li>
                  ))}
                </ol>
              ) : null}
              {answer.invocations.length > 0 ? (
                <ScrollableTable label={`Capabilities called for ${answer.requestId}`}>
                  <table className="mi-table">
                    <thead>
                      <tr>
                        <th scope="col">Capability</th>
                        <th scope="col">Kind</th>
                        <th scope="col">Chosen by</th>
                        <th scope="col">Outcome</th>
                        <th scope="col">Error</th>
                        <th scope="col">Chars</th>
                        <th scope="col">ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {answer.invocations.map((invocation, index) => (
                        <tr key={`${answer.id}-${invocation.capability}-${index}`}>
                          <th scope="row">{invocation.capability}</th>
                          <td>{invocation.kind}</td>
                          <td>{invocation.selectedBy}</td>
                          <td>{invocation.outcome}</td>
                          <td>{invocation.errorCode ?? ''}</td>
                          <td>{invocation.outputChars}</td>
                          <td>{invocation.durationMs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollableTable>
              ) : null}
              <p className="media-lede">
                <time dateTime={answer.createdAt}>{stamp(answer.createdAt)}</time> · request {answer.requestId}
              </p>
            </article>
          ))
        )}
      </MediaSection>
    </MediaPage>
  );
}
