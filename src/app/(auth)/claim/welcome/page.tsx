import type { Metadata } from 'next';
import type { MyInvitation } from '@/capabilities/get_my_invitation';
import { claimPerson, signOut, updateEmail } from '../../_lib/actions';
import { readChallengeCookie } from '../../_lib/challenge-cookie';
import { errorCopy } from '../../_lib/errors';
import { currentPrincipal, invokeFromRequest } from '../../_lib/invoke';
import { Actions, AuthShell, Button, CodeInput, Field, Notice } from '../../_components/kit';
import { PasskeyEnroll } from '../passkey/PasskeyEnroll';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'You’re in', robots: { index: false, follow: false } };

/** Post-claim landing: confirm who you are, optional passkey, manage a shared inbox, change email. */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const principal = await currentPrincipal();
  if (principal.kind === 'admin') {
    return (
      <AuthShell eyebrow="Signed in" title="Welcome, administrator">
        <Actions>
          <a className="auth-link" href="/admin">Open the console</a>
        </Actions>
      </AuthShell>
    );
  }
  if (principal.kind !== 'guest') {
    return (
      <AuthShell eyebrow="Sign in" title="Please sign in first">
        <Actions>
          <a className="auth-link" href="/sign-in">Sign in with your email</a>
        </Actions>
      </AuthShell>
    );
  }
  const r = await invokeFromRequest<MyInvitation>('get_my_invitation', {}, { method: 'GET' });
  if (!r.ok) {
    return (
      <AuthShell eyebrow="Signed in" title="Welcome">
        <Notice tone="error">We couldn’t load your invitation just now. Please refresh in a moment.</Notice>
      </AuthShell>
    );
  }
  const d = r.value.data;
  const error = errorCopy(sp.error);
  const pendingEmail = sp.contact === '1' ? await readChallengeCookie() : null;
  const changing = pendingEmail?.kind === 'change_email' ? pendingEmail : null;
  const others = d.members.filter((m) => !m.isYou && m.kind !== 'child' && !m.isMinor);
  const firstName = d.you.displayName.split(' ')[0];
  return (
    <AuthShell
      eyebrow="You’re in"
      title={`Welcome, ${firstName}`}
      lede={
        <p>
          You’re signed in as <strong>{d.you.displayName}</strong> from {d.household.name}
          {d.you.isManager ? ' — you manage the RSVP for your household.' : '.'}
        </p>
      }
      footer={
        <form action={signOut}>
          <Button variant="ghost">Sign out</Button>
        </form>
      }
    >
      {sp.switched ? <Notice tone="success">Done — you’re now signed in as {d.you.displayName}.</Notice> : null}
      {sp.contact === 'done' ? <Notice tone="success">Your email is updated. Future codes will go to the new address.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Actions>
        <a className="auth-button auth-button-primary" href="/your-weekend">
          Go to Your Weekend
        </a>
      </Actions>

      <PasskeyEnroll />

      {others.length > 0 ? (
        <section className="auth-field" aria-labelledby="not-you">
          <h2 id="not-you" className="auth-label">
            Not {firstName}? Pick yourself
          </h2>
          <p className="auth-hint">If you share this email with someone on the invitation, choose your own name.</p>
          <ul className="auth-list">
            {others.map((m) => (
              <li key={m.guestId}>
                <span>
                  {m.displayName}
                  {m.claimed ? ' · claimed' : m.managedByYou ? ' · you manage their RSVP' : ''}
                </span>
                <form action={claimPerson}>
                  <input type="hidden" name="guestId" value={m.guestId} />
                  <Button variant="ghost">I’m {m.displayName.split(' ')[0]}</Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="auth-field" aria-labelledby="contact-heading">
        <h2 id="contact-heading" className="auth-label">
          Use a different email?
        </h2>
        {changing ? (
          <form action={updateEmail}>
            <p className="auth-hint">We sent a code to {changing.to ?? changing.email}. Enter it to confirm the change.</p>
            <Field id="code" label="Six-digit code" error={sp.contact === '1' ? error : null}>
              <CodeInput error={error} />
            </Field>
            <Actions>
              <Button>Confirm new email</Button>
            </Actions>
          </form>
        ) : (
          <form action={updateEmail}>
            <Field id="email" label="New email address" hint="We’ll send a code there before anything changes.">
              <input id="email" name="email" type="email" className="auth-input" autoComplete="email" required maxLength={254} />
            </Field>
            <Actions>
              <Button variant="ghost">Send a code to the new address</Button>
            </Actions>
          </form>
        )}
      </section>
    </AuthShell>
  );
}
