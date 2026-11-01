import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sendPhoneSignInCode } from '../../_lib/actions';
import { currentPrincipal } from '../../_lib/invoke';
import { isSafeReturnPath } from '@/domain/identity/routes';
import { errorCopy } from '../../_lib/errors';
import { Actions, AuthShell, Button, Field, Notice } from '../../_components/kit';
import { isPhoneSignInAvailable } from '@/lib/phone-sign-in';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in with your phone', robots: { index: false, follow: false } };

/** SMS sign-in when FLAG_PHONE_SIGN_IN is on and Twilio Verify is configured (or mock locally). */
export default async function PhoneSignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!isPhoneSignInAvailable()) redirect('/sign-in');
  const sp = await searchParams;
  const error = errorCopy(sp.error);
  const principal = await currentPrincipal();
  if (principal.kind === 'guest' || principal.kind === 'admin') {
    if (isSafeReturnPath(sp.next) && sp.next.split('?')[0]!.replace(/\/+$/, '') !== '/sign-in/phone') redirect(sp.next);
    redirect(principal.kind === 'admin' ? '/admin' : '/your-weekend');
  }
  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in with your phone"
      lede={<p>Enter the mobile number Sara and Tyler have for you. We’ll text a six-digit code — no password needed.</p>}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form action={sendPhoneSignInCode}>
        {isSafeReturnPath(sp.next) ? <input type="hidden" name="next" value={sp.next} /> : null}
        <Field id="phone" label="Mobile number" hint="US numbers only for now. Include area code.">
          <input id="phone" name="phone" type="tel" className="auth-input" autoComplete="tel" inputMode="tel" required maxLength={32} aria-describedby="phone-hint" />
        </Field>
        <Actions>
          <Button>Text me a code</Button>
        </Actions>
      </form>
      <p className="auth-hint">
        Prefer email?{' '}
        <Link className="auth-link" href={isSafeReturnPath(sp.next) ? `/sign-in?next=${encodeURIComponent(sp.next)}` : '/sign-in'}>
          Sign in with a code to your inbox
        </Link>
      </p>
    </AuthShell>
  );
}
