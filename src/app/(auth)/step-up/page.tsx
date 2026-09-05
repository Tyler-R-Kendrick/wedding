import type { Metadata } from 'next';
import { isInternalRoute } from '@/capabilities/routes';
import { requestStepUpCode, stepUpWithCode } from '../_lib/actions';
import { currentPrincipal } from '../_lib/invoke';
import { Actions, AuthShell, Button, CodeInput, Field, Notice } from '../_components/kit';
import { PasskeyStepUp } from './PasskeyStepUp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Confirm it’s you', robots: { index: false, follow: false } };

/** Step-up (ADR-0001 rule 4): a fresh code or passkey before money/identity actions. */
export default async function StepUpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = sp.next && isInternalRoute(sp.next) ? sp.next : '/claim/welcome';
  const principal = await currentPrincipal();
  if (principal.kind === 'anonymous') {
    return (
      <AuthShell eyebrow="Sign in" title="Please sign in first">
        <Actions>
          <a className="auth-link" href={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in with your email</a>
        </Actions>
      </AuthShell>
    );
  }
  const error = sp.error ? (sp.m ?? 'That didn’t work. Please try again.') : null;
  return (
    <AuthShell eyebrow="For your security" title="Confirm it’s you" lede={<p>This step protects things like changing your email or claiming a ride voucher. It takes a moment.</p>}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <PasskeyStepUp next={next} />
      {sp.c ? (
        <form action={stepUpWithCode}>
          <input type="hidden" name="challenge" value={sp.c} />
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="to" value={sp.to ?? ''} />
          <p className="auth-hint">We sent a code to {sp.to ?? 'your email'}.</p>
          <Field id="code" label="Six-digit code" error={error}>
            <CodeInput error={error} />
          </Field>
          <Actions>
            <Button>Confirm</Button>
          </Actions>
        </form>
      ) : (
        <form action={requestStepUpCode}>
          <input type="hidden" name="next" value={next} />
          <Actions>
            <Button variant="ghost">Email me a code</Button>
          </Actions>
        </form>
      )}
    </AuthShell>
  );
}
