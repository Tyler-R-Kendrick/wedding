import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';

/**
 * Gate for development-only endpoints (dev inbox, identity fixtures): open only in local
 * development (NODE_ENV=development, not on Vercel/CI) or with a `DEV_INBOX_TOKEN` bearer.
 * Never available in production without the token, and never with a mismatched one.
 */
export function devEndpointAllowed(request: Request): boolean {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (env.DEV_INBOX_TOKEN && bearer && timingSafeEqualString(bearer, env.DEV_INBOX_TOKEN)) return true;
  if (env.isProduction) return false;
  const hosted = !!process.env.VERCEL || !!process.env.CI;
  return !hosted;
}
