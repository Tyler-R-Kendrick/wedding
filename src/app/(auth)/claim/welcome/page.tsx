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
  // Every adult member used to get an "I'm <name>" button, and three of the four outcomes are
  // guaranteed refusals. The page already knew enough to say so — it printed "· claimed" and
  // "· you manage their RSVP" beside the names — and offered the button anyway.
  const others = d.members.filter((m) => !m.isYou && m.kind !== 'child' && !m.isMinor);
  const actionable = others.filter((m) => m.claimAction === 'switch' || m.claimAction === 'manage');
  const blocked = others.filter((m) => m.claimAction !== 'switch' && m.claimAction !== 'manage');
  const WHY: Record<string, string> = {
    own_inbox: 'signs in with their own email',
    not_manager: 'only your household manager can act for them',
    claimed_elsewhere: 'already claimed with a different email — ask Sara and Tyler',
  };
  const firstName = d.you.displayName.split(' ')[0];
  // A guest with no email of their own is claimed through their household manager and the session
  // becomes the manager's — correct, and by design (ADR-0001). Nothing on this page said so, so a
  // guest who picked her own name on the invitation was greeted "Welcome, Dev", told she was signed
  // in as Dev Fixture, and told she manages the RSVP for the household. Three sentences false about
  // the person reading them. Only shown when the two names actually differ.
  const picked = typeof sp.picked === 'string' && sp.picked !== d.you.displayName ? sp.picked : null;
  return (
    <AuthShell
      eyebrow="You’re in"
      title={picked ? `Welcome, ${picked.split(' ')[0]}` : `Welcome, ${firstName}`}
      lede={
        picked ? (
          <p>
            You picked <strong>{picked}</strong>. {picked.split(' ')[0]} has no email on the invitation, so the code went to <strong>{d.you.displayName}</strong>’s inbox and that is the name this session is
            signed in as — {picked.split(' ')[0]}’s answers go in from here, together with the rest of {d.household.name}.
          </p>
        ) : (
          <p>
            You’re signed in as <strong>{d.you.displayName}</strong> from {d.household.name}
            {d.you.isManager ? ' — you manage the RSVP for your household.' : '.'}
          </p>
        )
      }
      footer={
        <form action={signOut}>
          <Button variant="ghost">Sign out</Button>
        </form>
      }
    >
      {/* `claim_identity` has two successes and this claimed the wrong one for half of them: taking
          on someone with no inbox of their own returns `managed` and deliberately does NOT move the
          session (`claim_identity.ts`), yet the redirect and this notice both said "you're now
          signed in as <the name it already showed>". The action now says which happened. */}
      {sp.switched === '1' ? <Notice tone="success">Done — you’re now signed in as {d.you.displayName}.</Notice> : null}
      {sp.switched === 'managed' ? (
        <Notice tone="success">Done — you now answer for {sp.who ? decodeURIComponent(sp.who) : 'them'}. You are still signed in as {d.you.displayName}.</Notice>
      ) : null}
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
            {actionable.map((m) => (
              <li key={m.guestId}>
                <span>
                  {m.displayName}
                  {m.claimed ? ' · claimed' : m.managedByYou ? ' · you manage their RSVP' : ''}
                </span>
                <form action={claimPerson}>
                  <input type="hidden" name="guestId" value={m.guestId} />
                  <Button variant="ghost">{m.claimAction === 'switch' ? `I’m ${m.displayName.split(' ')[0]}` : `Answer for ${m.displayName.split(' ')[0]}`}</Button>
                </form>
              </li>
            ))}
            {blocked.map((m) => (
              <li key={m.guestId}>
                <span>
                  {m.displayName} · {WHY[m.claimAction] ?? 'not available from here'}
                </span>
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
