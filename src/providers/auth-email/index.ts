import type { ServerEnv } from '@/lib/env';
import { MockAuthEmail } from './mock';
import { ResendAuthEmail } from './resend';
import type { AuthEmailProvider } from './types';

export * from './types';
export { MockAuthEmail, devInbox } from './mock';
export { ResendAuthEmail } from './resend';

export function createAuthEmailProvider(env: Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'RESEND_CONNECT_USER_ID' | 'EMAIL_FROM'> & { isProduction?: boolean }): AuthEmailProvider {
  if (!env.FORCE_MOCK_PROVIDERS && env.RESEND_CONNECT_USER_ID && env.EMAIL_FROM) return new ResendAuthEmail(env.RESEND_CONNECT_USER_ID, env.EMAIL_FROM);
  // One-time codes must never land in the in-memory dev inbox on a production host (review S6).
  if (env.isProduction) throw new Error('auth-email: production requires RESEND_CONNECT_USER_ID and EMAIL_FROM; the mock mailer is refused');
  return new MockAuthEmail();
}
