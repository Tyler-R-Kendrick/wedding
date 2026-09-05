import type { Metadata } from 'next';
import type { InvitationLookup } from '@/capabilities/lookup_invitation';
import { isSafeReturnPath } from '@/domain/identity/routes';
import { startClaim } from '../../_lib/actions';
import { invokeFromRequest } from '../../_lib/invoke';
import { errorCopy } from '../../_lib/errors';
import { Actions, AuthShell, Button, Notice, RecoveryPanel } from '../../_components/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your invitation', robots: { index: false, follow: false } };


/**
 * Discovery page (ADR-0001 rule 1): "We found your invitation" + pick yourself. Never a session.
 * The claim goes to the inbox on file for the person picked (or their household manager).
 */
export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const r = await invokeFromRequest<InvitationLookup>('lookup_invitation', { token }, { method: 'GET' });
  if (!r.ok) {
    return (
      <AuthShell eyebrow="Your invitation" title="One moment">
        <Notice tone="error">{errorCopy(r.error.code === 'rate_limited' ? 'rate_limited' : 'internal')}</Notice>
      </AuthShell>
    );
  }
  const d = r.value.data;
  if (d.status !== 'found') {
    return (
      <AuthShell eyebrow="Your invitation" title={d.recovery.title}>
        <RecoveryPanel title="What to do next" message={d.recovery.message} />
      </AuthShell>
    );
  }
  const error = errorCopy(sp.error === 'validation' ? 'pick' : sp.error);
  const claimable = d.members.filter((m) => m.claimable);
  return (
    <AuthShell
      eyebrow="We found your invitation"
      title={d.household.name}
      lede={
        <p>
          Sara and Tyler have you down for {d.events.length > 0 ? `${d.events.length} ${d.events.length === 1 ? 'event' : 'events'}` : 'the celebration'}. Pick your name and we’ll send a six-digit code to the email on file — no password, nothing to remember.
        </p>
      }
      footer={<p>This link only shows who is invited. Codes go to the email Sara and Tyler already have, so a forwarded link can’t be used by someone else.</p>}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form action={startClaim} className="auth-field">
        <input type="hidden" name="token" value={token} />
        {isSafeReturnPath(sp.next) ? <input type="hidden" name="next" value={sp.next} /> : null}
        <fieldset className="auth-field">
          <legend className="auth-label">Who are you?</legend>
          <ul className="auth-choices">
            {d.members.map((m) => {
              const disabled = !m.claimable;
              const meta = m.kind === 'child' || m.isMinor ? `Included through ${m.managerName ?? 'the household'}` : m.claimed ? 'Already claimed — pick this name to sign in again' : m.claimVia === 'manager_email' ? `Code goes to ${m.managerName ?? 'the household manager'}` : m.claimVia === 'none' ? 'No email on file yet' : 'Code goes to your email';
              return (
                <li key={m.guestId}>
                  <label className={`auth-choice${disabled ? ' auth-choice-disabled' : ''}`}>
                    <input type="radio" name="guestId" value={m.guestId} disabled={disabled} required={claimable.length > 0} />
                    <span>
                      {m.displayName}
                      <span className="auth-choice-meta">{meta}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <Actions>
          <Button>Send me a code</Button>
          <a className="auth-link" href="/sign-in">
            I’ve claimed before — sign in
          </a>
        </Actions>
      </form>
    </AuthShell>
  );
}
