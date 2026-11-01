import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { isGuestPassSlugShape, resolveGuestPassPage } from '@/domain/identity/guest-pass';
import { verifyGuestPass } from './_lib/actions';
import { MagicPassForm } from './_components/MagicPassAutoSubmit';
import { Actions, AuthShell, Button, Notice } from '../../_components/kit';
import { errorCopy } from '../../_lib/errors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

const MESSAGES = {
  expired: {
    title: 'This sign-in link has expired',
    body: 'Ask Sara and Tyler for a fresh link, or sign in with the email they have for you.',
  },
  revoked: {
    title: 'This sign-in link is no longer active',
    body: 'Ask Sara and Tyler for a new link, or sign in with your email.',
  },
};

export default async function GuestPassPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  if (!isGuestPassSlugShape(slug)) notFound();
  const sp = await searchParams;
  const error = errorCopy(sp.error);
  const db = await getDb();
  const page = await resolveGuestPassPage(db, slug);
  if (!page) notFound();

  const active = page.lifecycle === 'active' && page.code;
  const recovery = page.lifecycle !== 'active' ? MESSAGES[page.lifecycle] : null;

  return (
    <AuthShell
      eyebrow="Welcome"
      title={active && !error ? 'Signing you in…' : 'Sign in with your link'}
      lede={
        active ? (
          <p>
            We are signing in <strong>{page.guestDisplayName}</strong>. This usually takes a moment.
          </p>
        ) : recovery ? (
          <p>{recovery.body}</p>
        ) : (
          <p>Something went wrong with this link.</p>
        )
      }
      footer={
        <p>
          Prefer email instead?{' '}
          <Link className="auth-link" href="/sign-in">
            Sign in with a code to your inbox
          </Link>
          .
        </p>
      }
    >
      {recovery ? (
        <Notice tone="error" title={recovery.title}>
          <p>
            <Link className="auth-link link-block" href="/sign-in">
              Sign in with your email
            </Link>
          </p>
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" title="We could not sign you in">
          <p>{error}</p>
          <p>
            <Link className="auth-link link-block" href="/sign-in">
              Try signing in with your email
            </Link>
          </p>
        </Notice>
      ) : null}
      {active ? (
        <MagicPassForm slug={slug} code={page.code!} action={verifyGuestPass} disabled={Boolean(error)}>
          <Notice tone="info">
            <p aria-live="polite">Signing you in…</p>
          </Notice>
          <Actions>
            <Button>Continue</Button>
          </Actions>
        </MagicPassForm>
      ) : null}
    </AuthShell>
  );
}
