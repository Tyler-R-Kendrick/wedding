import type { ServerEnv } from '@/lib/env';
import { MockAuthEmail } from './mock';
import { ResendAuthEmail } from './resend';
import type { AuthEmailProvider } from './types';

export * from './types';
export { MockAuthEmail, devInbox } from './mock';
export { ResendAuthEmail } from './resend';

export function createAuthEmailProvider(env: Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'RESEND_API_KEY' | 'EMAIL_FROM'>): AuthEmailProvider {
  if (!env.FORCE_MOCK_PROVIDERS && env.RESEND_API_KEY && env.EMAIL_FROM) return new ResendAuthEmail(env.RESEND_API_KEY, env.EMAIL_FROM);
  return new MockAuthEmail();
}
