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
  // The lock lives at VERIFY time and sending is not gated on it, so "request a new code" always
  // appeared to work: a fresh code arrived, this page said "we sent a code … it works for 10
  // minutes" with no mention of the pause, and the correct new code was refused exactly like the
  // wrong ones. The remedy the page named could not work, and a guest can loop on that forever.
  // The instant comes from `request_otp` through the HttpOnly challenge cookie.
  // Named as an INSTANT, not a countdown: a sentence about a clock time stays true however long the
  // page sits open, and rendering needs no clock of its own (`Date.now()` in render is impure). The
  // capability decided there was a live lock when it sent this code; the cookie carrying it lives
  // ten minutes and the lock fifteen, so it cannot outlast what it describes by much.
  const lockedTime = usable?.lockedUntil ? new Date(usable.lockedUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short' }) : null;
  return (
    <AuthShell
      eyebrow="Check your email"
      title="Enter your six-digit code"
      lede={
        usable ? (
          <p>
            We sent a code to <strong>{usable.to ?? 'the email on file'}</strong>
            {usable.for ? ` (${usable.for}’s email, since they manage the RSVP)` : ''}. It works for 10 minutes.
          </p>
        ) : (
          // Said "We sent a code to the email on file" directly above "This page needs a fresh
          // code" — a claim about something that had not happened, and the two contradicted.
          <p>This page has no code waiting for it. Start again and we will send you one.</p>
        )
      }
      footer={
        <p>
          Nothing arrived? Check spam, then{' '}
          <a className="auth-link" href={back}>
            request a new code
          </a>
          . If the address Sara and Tyler have for you is wrong, a code will never arrive — ask them to fix it.
        </p>
      }
    >
      {!usable ? (
        <Notice tone="error">
          This page needs a fresh code. <a className="auth-link" href={back}>Start again</a>.
        </Notice>
      ) : (
        <>
          {lockedTime ? (
            <Notice tone="error" title="Sign-in is paused">
              <p>
                Too many incorrect codes were entered, so codes are refused until about <strong>{lockedTime}</strong>. Asking for another one now will send it, but it will be refused too — wait, then
                request a fresh code.
              </p>
            </Notice>
          ) : null}
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
        </>
      )}
    </AuthShell>
  );
}
