import type { Metadata } from 'next';
import { safeReturnPath } from '@/domain/identity/routes';
import { verifyCode } from '../../_lib/actions';
import { readChallengeCookie } from '../../_lib/challenge-cookie';
import { errorCopy } from '../../_lib/errors';
import { Actions, AuthShell, Button, CodeInput, Field, Notice } from '../../_components/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Enter your code', robots: { index: false, follow: false } };

/** The OTP screen — the most-tested UI on the site (ADR-0001). One field, one job. The challenge lives in an HttpOnly cookie. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const cookie = await readChallengeCookie();
  const usable = cookie && ['claim', 'sign_in', 'admin_sign_in'].includes(cookie.kind) ? cookie : null;
  const back = safeReturnPath(usable?.back, '/sign-in');
  const error = errorCopy(sp.error);
  return (
    <AuthShell
      eyebrow="Check your email"
      title="Enter your six-digit code"
      lede={
        <p>
          We sent a code to <strong>{usable?.to ?? 'the email on file'}</strong>
          {usable?.for ? ` (${usable.for}’s email, since they manage the RSVP)` : ''}. It works for 10 minutes.
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
      {!usable ? (
        <Notice tone="error">
          This page needs a fresh code. <a className="auth-link" href={back}>Start again</a>.
        </Notice>
      ) : (
        <form action={verifyCode}>
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
