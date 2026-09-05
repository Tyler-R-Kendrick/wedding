import { env } from '@/lib/env';
import { DEV_CONFIRMATION_SECRET } from '@/policy/confirmation';

/**
 * Preview tokens are signed with CONFIRMATION_SECRET (required in production by src/lib/env.ts);
 * outside production the development default applies. No new environment variable.
 */
export function getPreviewSecret(): string {
  if (env.CONFIRMATION_SECRET) return env.CONFIRMATION_SECRET;
  if (env.isProduction) throw new Error('CONFIRMATION_SECRET is required in production');
  return DEV_CONFIRMATION_SECRET;
}
