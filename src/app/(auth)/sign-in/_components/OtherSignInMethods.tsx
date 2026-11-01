import Link from 'next/link';
import { configuredSocialProviders } from '@/domain/identity/social/providers';
import { env } from '@/lib/env';
import { isSafeReturnPath } from '@/domain/identity/routes';

const LABELS = { google: 'Continue with Google', facebook: 'Continue with Facebook' } as const;

export function OtherSignInMethods({ next }: { next?: string }) {
  const providers = configuredSocialProviders();
  const phone = env.GUEST_PHONE_SIGN_IN === true;
  if (!providers.length && !phone) return null;
  const nextParam = isSafeReturnPath(next) ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <section className="auth-other" aria-labelledby="auth-other-heading">
      <h2 id="auth-other-heading" className="auth-other__heading">
        Other ways to sign in
      </h2>
      {phone ? (
        <p className="auth-hint">Phone sign-in is coming soon. Use your email code for now.</p>
      ) : null}
      <ul className="auth-other__list">
        {providers.map((id) => (
          <li key={id}>
            <Link className="auth-button auth-button-ghost auth-other__provider" href={`/api/auth/social/${id}/start${nextParam}`}>
              {LABELS[id]}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
