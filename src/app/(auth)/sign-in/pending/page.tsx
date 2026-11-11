import type { Metadata } from 'next';
import Link from 'next/link';
import { Actions, AuthShell } from '../../_components/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

/** Neutral outcome for every social sign-in that cannot bind automatically. */
export default function SignInPendingPage() {
  return (
    <AuthShell
      eyebrow="Almost there"
      title="Come back when your invitation has been sent!"
      lede={
        <p>
          Sara and Tyler will let you know when it is time. If you already have an invitation, try signing in with the email they have for you instead.
        </p>
      }
    >
      <Actions>
        <Link className="auth-link" href="/sign-in">
          Sign in with email
        </Link>
      </Actions>
    </AuthShell>
  );
}
