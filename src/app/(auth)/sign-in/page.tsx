import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sendSignInCode } from '../_lib/actions';
import { currentPrincipal } from '../_lib/invoke';
import { isSafeReturnPath } from '@/domain/identity/routes';
import { errorCopy } from '../_lib/errors';
import { Actions, AuthShell, Button, Field, Notice } from '../_components/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };


/** Returning guests: email → code. Identical response whether or not the address is known. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const error = errorCopy(sp.error);
  // Every page's header and footer link here, and public pages are prerendered, so "Sign in" is shown
  // to people who already are. Say so and send them on, rather than asking for a code they don't need.
  const principal = await currentPrincipal();
  if (principal.kind === 'guest' || principal.kind === 'admin') {
    // A link that asked for sign-in on the way somewhere (`?next=/rsvp`) goes there: nothing to do here.
    // (`/sign-in` itself is a safe path too, and would loop.)
    if (isSafeReturnPath(sp.next) && sp.next.split('?')[0]!.replace(/\/+$/, '') !== '/sign-in') redirect(sp.next);
    return (
      <AuthShell eyebrow="Welcome back" title="You’re already signed in" lede={<p>Pick up where you left off.</p>}>
        <Actions>
          {principal.kind === 'admin' ? (
            <Link className="auth-link" href="/admin">
              Go to the admin console
            </Link>
          ) : (
            <Link className="auth-link" href="/your-weekend">
              Go to your weekend
            </Link>
          )}
          <Link className="auth-link" href="/sign-out">
            Sign out
          </Link>
        </Actions>
        {/* A couple who claimed their own invitation are signed in as a guest; the console is a separate sign-in. */}
        {principal.kind === 'guest' ? <AdminSignInHint /> : null}
      </AuthShell>
    );
  }
  return (
    <AuthShell eyebrow="Welcome back" title="Sign in with your email" lede={<p>Enter the email Sara and Tyler have for you and we’ll send a six-digit code. No password needed.</p>}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form action={sendSignInCode}>
        {isSafeReturnPath(sp.next) ? <input type="hidden" name="next" value={sp.next} /> : null}
        <Field id="email" label="Email address" hint="The one your invitation was sent to.">
          <input id="email" name="email" type="email" className="auth-input" autoComplete="email" inputMode="email" required maxLength={254} aria-describedby="email-hint" />
        </Field>
        <Actions>
          <Button>Send me a code</Button>
        </Actions>
      </form>
      <p className="auth-hint">If you receive nothing within a minute, check spam — or open your invitation link again to start fresh.</p>
      <AdminSignInHint />
    </AuthShell>
  );
}

/** The couple sign in to the console through a separate, allowlisted flow (admin_sign_in). */
function AdminSignInHint() {
  return (
    <p className="auth-hint">
      Sara or Tyler?{' '}
      <Link className="auth-link" href="/sign-in/admin">
        Sign in to manage the site
      </Link>
    </p>
  );
}
