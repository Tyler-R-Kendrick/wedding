import type { Metadata } from 'next';
import { sendSignInCode } from '../../_lib/actions';
import { Actions, AuthShell, Button, Field, Notice } from '../../_components/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Administrator sign-in', robots: { index: false, follow: false } };

/** Admin sign-in: same OTP flow, allowlisted emails only, identical response for unknown addresses. */
export default async function AdminSignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <AuthShell eyebrow="Administration" title="Sign in to the console" lede={<p>Enter your administrator email. We’ll send a six-digit code.</p>}>
      {sp.error ? <Notice tone="error">{sp.m ?? 'Something didn’t work. Please try again.'}</Notice> : null}
      <form action={sendSignInCode}>
        <input type="hidden" name="admin" value="1" />
        <input type="hidden" name="next" value={sp.next ?? '/admin'} />
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
