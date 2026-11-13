import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sendPhoneSignInCode, sendSignInCode } from '../_lib/actions';
import { currentPrincipal } from '../_lib/invoke';
import { isSafeReturnPath } from '@/domain/identity/routes';
import { guestSignInLandingPath } from '@/domain/lifecycle/guest-portal';
import { errorCopy } from '../_lib/errors';
import { GUEST_SAVE_THE_DATE_PATH, SIGN_IN_CODE_PROMISE_EMAIL, SIGN_IN_CODE_PROMISE_PHONE, SIGN_IN_SAVE_THE_DATE_NOTE } from '../_lib/guest-auth-copy';
import { Actions, AuthShell, Button, Field, Notice } from '../_components/kit';
import { isPhoneSignInAvailable } from '@/lib/phone-sign-in';
import { OtherSignInMethods } from './_components/OtherSignInMethods';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

type Method = 'email' | 'text';

/**
 * Returning guests: a six-digit code by text or by email, as two tabs. Text is the default wherever
 * a text can be sent (src/lib/phone-sign-in.ts); email is the other tab, and the only form where no
 * text can be sent. Identical response whether or not the address or number is known.
 *
 * The tabs are links (`?method=email`, and `?method=text` for links that ask for text by name), so
 * they work without JavaScript, keep the choice in the address after an error, and need nothing
 * from the keyboard but Tab and Enter.
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (sp.error === 'guest_not_found') redirect(GUEST_SAVE_THE_DATE_PATH);
  const error = errorCopy(sp.error);
  // Every page's header and footer link here, and public pages are prerendered, so "Sign in" is shown
  // to people who already are. Say so and send them on, rather than asking for a code they don't need.
  const principal = await currentPrincipal();
  if (principal.kind === 'guest' || principal.kind === 'admin') {
    // A link that asked for sign-in on the way somewhere (`?next=/rsvp`) goes there: nothing to do here.
    // (`/sign-in` itself is a safe path too, and would loop.)
    if (isSafeReturnPath(sp.next) && sp.next.split('?')[0]!.replace(/\/+$/, '') !== '/sign-in') {
      redirect(principal.kind === 'admin' ? sp.next : guestSignInLandingPath(sp.next, '/guests'));
    }
    if (principal.kind === 'guest') redirect('/guests');
    redirect('/admin');
  }
  const next = isSafeReturnPath(sp.next) ? sp.next : undefined;
  const texting = await isPhoneSignInAvailable();
  const method: Method = texting && sp.method !== 'email' ? 'text' : 'email';
  const tabHref = (m: Method) => {
    const q = new URLSearchParams();
    if (m === 'email') q.set('method', 'email');
    if (next) q.set('next', next);
    const s = q.toString();
    return s ? `/sign-in?${s}` : '/sign-in';
  };

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in"
      lede={
        <p>
          {texting ? 'Sign in with a six-digit code by text or email — no password needed.' : 'Sign in with a six-digit code by email — no password needed.'}{' '}
          {SIGN_IN_SAVE_THE_DATE_NOTE}
        </p>
      }
    >
      {texting ? (
        <nav className="auth-methods" aria-label="How to get your code">
          <Link className="auth-method" href={tabHref('text')} aria-current={method === 'text' ? 'page' : undefined} replace scroll={false}>
            Text
          </Link>
          <Link className="auth-method" href={tabHref('email')} aria-current={method === 'email' ? 'page' : undefined} replace scroll={false}>
            Email
          </Link>
        </nav>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {method === 'text' ? (
        <>
          <form action={sendPhoneSignInCode}>
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <Field id="phone" label="Mobile number" hint="US numbers only for now. Include area code.">
              <input id="phone" name="phone" type="tel" className="auth-input" autoComplete="tel" inputMode="tel" required maxLength={32} aria-describedby="phone-hint" />
            </Field>
            <Actions>
              <Button>Text me a code</Button>
            </Actions>
          </form>
          <p className="auth-hint">{SIGN_IN_CODE_PROMISE_PHONE} Nothing arrived? Check the number or try email instead.</p>
        </>
      ) : (
        <>
          <form action={sendSignInCode}>
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <Field id="email" label="Email address" hint="Use the email you expect correspondence on.">
              <input id="email" name="email" type="email" className="auth-input" autoComplete="email" inputMode="email" required maxLength={254} aria-describedby="email-hint" />
            </Field>
            <Actions>
              <Button>Send me a code</Button>
            </Actions>
          </form>
          <p className="auth-hint">{SIGN_IN_CODE_PROMISE_EMAIL} Check spam if nothing arrives within a minute.</p>
        </>
      )}
      <OtherSignInMethods next={sp.next} />
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
