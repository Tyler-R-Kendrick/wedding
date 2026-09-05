'use client';

import { useActionState } from 'react';
import { issueInvitation, type IssuedLink } from '../_lib/actions';

/** The token is shown exactly once, so the result renders inline rather than through a redirect. */
export function IssueForm({ households, rotateId }: { households: { id: string; name: string }[]; rotateId?: string }) {
  const [state, action, pending] = useActionState<IssuedLink, FormData>(issueInvitation, { ok: false });
  return (
    <form action={action} className="ops-form">
      {rotateId ? (
        <input type="hidden" name="invitationId" value={rotateId} />
      ) : (
        <>
          <div className="ops-field">
            <label htmlFor="issue-household">Household</label>
            <select id="issue-household" name="householdId" className="ops-input" required>
              {households.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ops-field">
            <label htmlFor="issue-events">Event keys</label>
            <span className="ops-hint">Semicolon-separated, e.g. ceremony; reception</span>
            <input id="issue-events" name="eventKeys" className="ops-input" defaultValue="ceremony; reception" />
          </div>
          <div className="ops-field">
            <label htmlFor="issue-plus">Plus-ones allowed</label>
            <input id="issue-plus" name="plusOneAllowance" type="number" min={0} max={10} defaultValue={0} className="ops-input" />
          </div>
          <div className="ops-field">
            <label htmlFor="issue-children">Children allowed</label>
            <input id="issue-children" name="childrenAllowance" type="number" min={0} max={20} defaultValue={0} className="ops-input" />
          </div>
        </>
      )}
      <div className="ops-field">
        <button type="submit" className={`ops-button ${rotateId ? 'ops-button-ghost' : 'ops-button-primary'}`} disabled={pending}>
          {pending ? 'Working…' : rotateId ? 'Rotate link' : 'Issue link'}
        </button>
      </div>
      {state.error ? (
        <p className="ops-notice ops-notice-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.url ? (
        <div className="ops-section" role="status" data-testid="issued-link">
          <p>
            <strong>New link (shown once — copy it now):</strong>
          </p>
          <p className="ops-code">{state.url}</p>
          {state.qrSvg ? (
            /* eslint-disable-next-line @next/next/no-img-element -- generated data URI, no optimisation possible */
            <img className="ops-qr" alt={`QR code for the invitation link`} src={`data:image/svg+xml;utf8,${encodeURIComponent(state.qrSvg)}`} />
          ) : null}
          <p className="ops-hint">Expires {state.expiresAt ? new Date(state.expiresAt).toLocaleDateString('en-US', { dateStyle: 'medium' }) : ''}.</p>
        </div>
      ) : null}
    </form>
  );
}
