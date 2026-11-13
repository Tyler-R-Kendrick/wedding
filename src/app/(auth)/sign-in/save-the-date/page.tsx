import type { Metadata } from 'next';
import Link from 'next/link';
import { isSafeReturnPath } from '@/domain/identity/routes';
import { Actions, AuthShell, Notice } from '../../_components/kit';
import { SAVE_THE_DATE_COPY } from '../../_lib/guest-auth-copy';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Save the date', robots: { index: false, follow: false } };

/**
 * Neutral landing after social sign-in cannot bind, and for other non-session outcomes that
 * should not read as rejection. No `error` query param — not an error state.
 */
export default async function SaveTheDatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = isSafeReturnPath(sp.next) ? sp.next : undefined;
  const signInHref = next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in';

  return (
    <AuthShell eyebrow={SAVE_THE_DATE_COPY.eyebrow} title={SAVE_THE_DATE_COPY.title} lede={<p>{SAVE_THE_DATE_COPY.body}</p>}>
      <Notice tone="info" title="What to do next">
        <p>{SAVE_THE_DATE_COPY.tryOther}</p>
      </Notice>
      <Actions>
        <Link className="auth-button auth-button-primary" href={signInHref}>
          Sign in with email or text
        </Link>
      </Actions>
      <p className="auth-hint">
        Prefer Google or Facebook?{' '}
        <Link className="auth-link" href={signInHref}>
          Open sign-in
        </Link>{' '}
        and choose another way to sign in.
      </p>
    </AuthShell>
  );
}
