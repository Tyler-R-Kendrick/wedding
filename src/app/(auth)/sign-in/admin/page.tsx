import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sendSignInCode } from '../../_lib/actions';
import { currentPrincipal } from '../../_lib/invoke';
import { safeReturnPath } from '@/domain/identity/routes';
import { errorCopy } from '../../_lib/errors';
import { Actions, AuthShell, Button, Field, Notice } from '../../_components/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Administrator sign-in', robots: { index: false, follow: false } };

/** Admin sign-in: same OTP flow, allowlisted emails only, identical response for unknown addresses. */
export default async function AdminSignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  // An administrator who is already signed in has nothing to do here: go where the link was headed.
  // (Never back to a sign-in page, which would loop.)
  if ((await currentPrincipal()).kind === 'admin') {
    const next = safeReturnPath(sp.next, '/admin');
    redirect(next.startsWith('/sign-in') ? '/admin' : next);
  }
  return (
    <AuthShell eyebrow="Administration" title="Sign in to the console" lede={<p>Enter your administrator email. We’ll send a six-digit code.</p>}>
      {sp.error ? <Notice tone="error">{errorCopy(sp.error)}</Notice> : null}
      <form action={sendSignInCode}>
        <input type="hidden" name="admin" value="1" />
        <input type="hidden" name="next" value={safeReturnPath(sp.next, '/admin')} />
        <Field id="email" label="Administrator email">
          <input id="email" name="email" type="email" className="auth-input" autoComplete="email" required maxLength={254} />
        </Field>
        <Actions>
          <Button>Send me a code</Button>
        </Actions>
      </form>
    </AuthShell>
  );
}
