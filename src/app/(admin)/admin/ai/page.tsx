import 'server-only';
import { invoke } from '@/capabilities/invoke';
import { listAiTraces } from '@/capabilities/list_ai_traces';
import { publicPageContext } from '@/domain/content/page-context';
import './admin-ai.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Concierge traces' };

/**
 * What the concierge was asked, what it actually said, and why (swarm J).
 *
 * Everything on this page comes from `list_ai_traces` through `invoke`, so the entitlement check is
 * the same one the API does; rendering behind an `allowed` flag is UX minimisation, not
 * authorization. Questions and answers are stored PII-redacted and truncated, and there is no
 * private chain-of-thought to show because none is ever stored (ADR-0003).
 */
export default async function AdminAiPage() {
  const { principal, ctx } = await publicPageContext();
  const allowed = principal.kind === 'admin' && principal.entitlements.has('admin_ai');
  if (!allowed) {
    return (
      <main id="main" className="ai-main">
        <h1>Concierge</h1>
        <p>Administrator sign-in with concierge access is required.</p>
      </main>
    );
  }
  const traces = await invoke(listAiTraces, ctx, { limit: 50 });
  if (!traces.ok) throw new Error(traces.error.message);
  const { answers, groundingFailures, securityAlerts, totals } = traces.value.data;

  return (
    <main id="main" className="ai-main">
      <h1>Concierge</h1>
      <p className="ai-muted">
        Every answer the concierge gave, with the verdict its verifier reached, the sources it cited and the capabilities it called. Questions and answers are redacted and expire with their session. No
        reasoning is stored, so there is none to show.
      </p>

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

      <h2>Security alerts</h2>
      {securityAlerts.length === 0 ? (
        <p className="ai-muted">No prompt-injection attempts have been recorded.</p>
      ) : (
        <div className="ai-scroll">
          <table className="ai-table">
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
                    <time dateTime={alert.at}>{alert.at.replace('T', ' ').slice(0, 16)}</time>
                  </td>
                  <td>{String(alert.metadata?.kind ?? 'source')}</td>
                  <td>{String(alert.metadata?.rules ?? '')}</td>
                  <td>{alert.answerId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Grounding failures</h2>
      {groundingFailures.length === 0 ? (
        <p className="ai-muted">Every claim the model made was supported by the source it cited.</p>
      ) : (
        <div className="ai-scroll">
          <table className="ai-table">
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
                    <time dateTime={failure.at}>{failure.at.replace('T', ' ').slice(0, 16)}</time>
                  </td>
                  <td>{String(failure.metadata?.intent ?? '')}</td>
                  <td>{String(failure.metadata?.claims ?? '')}</td>
                  <td>{String(failure.metadata?.dropped ?? '')}</td>
                  <td>{String(failure.metadata?.reasons ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Answers</h2>
      {answers.length === 0 ? (
        <p className="ai-muted">Nobody has asked the concierge anything yet.</p>
      ) : (
        answers.map((answer) => (
          <article key={answer.id} className={`ai-answer ${answer.status === 'refused' ? 'ai-answer--refused' : ''} ${answer.status === 'error' ? 'ai-answer--error' : ''}`} aria-labelledby={`a-${answer.id}`}>
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
            {answer.verifier.reasons.length > 0 ? <p className="ai-muted">Dropped because: {answer.verifier.reasons.join(', ')}.</p> : null}
            {answer.sources.length > 0 ? (
              <ol className="ai-list">
                {answer.sources.map((source) => (
                  <li key={`${answer.id}-${source.marker}`}>
                    [{source.marker}] {source.url ? <a href={source.url}>{source.title}</a> : source.title} · {source.trustClass}
                    {source.verifiedAt ? ` · checked ${source.verifiedAt.slice(0, 10)}` : ''}
                    {source.retrievedAt ? ` · retrieved ${source.retrievedAt.replace('T', ' ').slice(0, 16)}` : ''}
                  </li>
                ))}
              </ol>
            ) : null}
            {answer.invocations.length > 0 ? (
              <div className="ai-scroll">
                <table className="ai-table">
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
              </div>
            ) : null}
            <p className="ai-muted">
              <time dateTime={answer.createdAt}>{answer.createdAt.replace('T', ' ').slice(0, 16)}</time> · request {answer.requestId}
            </p>
          </article>
        ))
      )}
    </main>
  );
}
