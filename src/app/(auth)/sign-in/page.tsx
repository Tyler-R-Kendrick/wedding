import type { Metadata } from 'next';
import { sendSignInCode } from '../_lib/actions';
import { Actions, AuthShell, Button, Field, Notice } from '../_components/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

const ERRORS: Record<string, string> = {
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  unlinked: 'That email isn’t linked to an invitation yet. Open the link Sara and Tyler sent you, or get in touch with them.',
  validation: 'Enter the email address on your invitation.',
};

/** Returning guests: email → code. Identical response whether or not the address is known. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const error = sp.error ? (ERRORS[sp.error] ?? sp.m ?? 'Something didn’t work. Please try again.') : null;
  return (
    <AuthShell eyebrow="Welcome back" title="Sign in with your email" lede={<p>Enter the email Sara and Tyler have for you and we’ll send a six-digit code. No password needed.</p>}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form action={sendSignInCode}>
        {sp.next ? <input type="hidden" name="next" value={sp.next} /> : null}
        <Field id="email" label="Email address" hint="The one your invitation was sent to.">
          <input id="email" name="email" type="email" className="auth-input" autoComplete="email" inputMode="email" required maxLength={254} aria-describedby="email-hint" />
        </Field>
        <Actions>
          <Button>Send me a code</Button>
        </Actions>
      </form>
      <p className="auth-hint">If you receive nothing within a minute, check spam — or open your invitation link again to start fresh.</p>
    </AuthShell>
  );
}
