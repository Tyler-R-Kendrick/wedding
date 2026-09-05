import type { Metadata } from 'next';
import { currentPrincipal } from '../../_lib/invoke';
import { AuthShell, Actions } from '../../_components/kit';
import { PasskeyEnroll } from './PasskeyEnroll';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Passkey', robots: { index: false, follow: false } };

export default async function PasskeyPage() {
  const principal = await currentPrincipal();
  if (principal.kind === 'anonymous') {
    return (
      <AuthShell eyebrow="Sign in" title="Please sign in first">
        <Actions>
          <a className="auth-link" href="/sign-in">Sign in with your email</a>
        </Actions>
      </AuthShell>
    );
  }
  return (
    <AuthShell eyebrow="Optional" title="Passkeys" lede={<p>A passkey lets this device sign you in without a code. It never replaces codes — they keep working everywhere.</p>}>
      <PasskeyEnroll />
      <Actions>
        <a className="auth-link" href="/claim/welcome">Back</a>
      </Actions>
    </AuthShell>
  );
}
