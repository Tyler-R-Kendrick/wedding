'use client';

import { useActionState } from 'react';
import { proposeLifecycle, publishLifecycle, type PublishProposal } from '../_lib/ops-actions';

const EMPTY: PublishProposal = { ok: false };

/**
 * Two submits, deliberately. The first drafts (no side effects) and gets back a confirmation token
 * bound to this exact state and note; the second presents it. The token is single-use and only
 * redeemable from the website, so the review step cannot be skipped by anything — including by this
 * page, if it is ever refactored — without the pipeline refusing.
 */
export function PublishForm({ states, current }: { states: { to: string; direction: string; navGained: string[]; navLost: string[] }[]; current: string }) {
  const [proposal, propose, proposing] = useActionState(proposeLifecycle, EMPTY);
  const [published, publish, publishing] = useActionState(publishLifecycle, EMPTY);

  if (states.length === 0) {
    return <p className="con-note">There is nowhere to move from {current}: it is the last state.</p>;
  }

  return (
    <>
      <form action={propose} className="con-form">
        <div className="ops-field">
          <label htmlFor="to">Move the site to</label>
          <select id="to" name="to" className="ops-input" defaultValue={states[0]?.to} required>
            {states.map((s) => (
              <option key={s.to} value={s.to}>
                {s.to} ({s.direction})
              </option>
            ))}
          </select>
        </div>
        <div className="ops-field">
          <label htmlFor="note">Why (optional, admin-only)</label>
          <input id="note" name="note" type="text" className="ops-input" maxLength={500} defaultValue={proposal.note ?? ''} />
        </div>
        <button type="submit" className="ops-button ops-button-ghost" disabled={proposing}>
          {proposing ? 'Checking…' : 'Review the change'}
        </button>
      </form>

      {proposal.error ? (
        <p className="ops-notice ops-notice-error" role="alert">
          {proposal.error}
        </p>
      ) : null}
      {published.error ? (
        <p className="ops-notice ops-notice-error" role="alert">
          {published.error}
        </p>
      ) : null}

      {proposal.ok && proposal.token ? (
        <div className="ops-section">
          <h3 className="ops-h2">
            {proposal.from} → {proposal.to}
          </h3>
          <ul className="con-consequences">
            {(proposal.consequences ?? []).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <form action={publish} className="con-form">
            <input type="hidden" name="to" value={proposal.to} />
            <input type="hidden" name="note" value={proposal.note ?? ''} />
            <input type="hidden" name="token" value={proposal.token} />
            <input type="hidden" name="idem" value={proposal.idem ?? ''} />
            <button type="submit" className="ops-button ops-button-primary" disabled={publishing}>
              {publishing ? 'Publishing…' : `Publish ${proposal.to} to every guest`}
            </button>
          </form>
          <p className="con-note">This confirmation expires at {proposal.expiresAt}. Reviewing again issues a new one.</p>
        </div>
      ) : null}
    </>
  );
}
