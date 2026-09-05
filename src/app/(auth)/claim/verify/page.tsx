import type { Metadata } from 'next';
import { verifyCode } from '../../_lib/actions';
import { Actions, AuthShell, Button, CodeInput, Field, Notice } from '../../_components/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Enter your code', robots: { index: false, follow: false } };

/** The OTP screen — the most-tested UI on the site (ADR-0001). One field, one job. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const challenge = sp.c ?? '';
  const back = sp.back ?? '/sign-in';
  const error = sp.error ? (sp.m ?? 'That code didn’t work. Please try again.') : null;
  return (
    <AuthShell
      eyebrow="Check your email"
      title="Enter your six-digit code"
      lede={
        <p>
          We sent a code to <strong>{sp.to ?? 'the email on file'}</strong>
          {sp.for ? ` (${sp.for}’s email, since they manage the RSVP)` : ''}. It works for 10 minutes.
        </p>
      }
      footer={
        <p>
          Nothing arrived? Check spam, then{' '}
          <a className="auth-link" href={back}>
            request a new code
          </a>
          .
        </p>
      }
    >
      {!challenge ? (
        <Notice tone="error">
          This page needs a fresh code. <a className="auth-link" href={back}>Start again</a>.
        </Notice>
      ) : (
        <form action={verifyCode}>
          <input type="hidden" name="challenge" value={challenge} />
          <input type="hidden" name="to" value={sp.to ?? ''} />
          <input type="hidden" name="back" value={back} />
          <Field id="code" label="Six-digit code" hint="Digits only, no spaces." error={error}>
            <CodeInput error={error} />
          </Field>
          <Actions>
            <Button>Continue</Button>
            <a className="auth-link" href={back}>
              Send a new code
            </a>
          </Actions>
        </form>
      )}
    </AuthShell>
  );
}
