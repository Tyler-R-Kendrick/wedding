import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';

export interface DevGateEnv {
  isProduction: boolean;
  isDevelopment: boolean;
  DEV_INBOX_TOKEN?: string;
  /** Shared host (Vercel preview, CI): never open without the bearer. */
  hosted: boolean;
}

/**
 * Gate for development-only endpoints (dev inbox, identity fixtures).
 *  - production: never, whatever the caller presents (review S5)
 *  - otherwise a matching `DEV_INBOX_TOKEN` bearer opens them (previews, CI)
 *  - otherwise only a local development server (NODE_ENV=development, not VERCEL/CI)
 */
export function devEndpointAllowedFor(request: Request, e: DevGateEnv): boolean {
  if (e.isProduction) return false;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (e.DEV_INBOX_TOKEN && bearer && timingSafeEqualString(bearer, e.DEV_INBOX_TOKEN)) return true;
  return e.isDevelopment && !e.hosted;
}

export function devEndpointAllowed(request: Request): boolean {
  return devEndpointAllowedFor(request, { isProduction: env.isProduction, isDevelopment: env.isDevelopment, DEV_INBOX_TOKEN: env.DEV_INBOX_TOKEN, hosted: !!process.env.VERCEL || !!process.env.CI });
}
