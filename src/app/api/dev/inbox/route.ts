import { devEndpointAllowed } from '@/lib/auth/dev-gate';
import { jsonResponse } from '@/lib/request';
import { devInbox } from '@/providers/auth-email/mock';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';

/**
 * Development only: shows OTP emails captured by the mock auth-email provider (the inbox is
 * empty whenever a real mailer is configured). Never in production (which includes Vercel
 * previews, built with NODE_ENV=production); otherwise a local development server, or a
 * non-production shared host (CI) when the caller presents DEV_INBOX_TOKEN.
 */
function available(request: Request): boolean {
  // The gate first: in production resolving the auth-email provider throws when no mailer is
  // configured, which turned this 404 into a 500 (and told the caller the route exists).
  // Shared gate with /api/dev/identity: never in production, bearer for CI, else local dev only.
  if (!devEndpointAllowed(request)) return false;
  return getProvider('auth-email').name === 'mock';
}

export async function GET(request: Request) {
  if (!available(request)) return new Response(null, { status: 404 });
  return jsonResponse({ messages: devInbox.list() });
}

export async function DELETE(request: Request) {
  if (!available(request)) return new Response(null, { status: 404 });
  devInbox.clear();
  return jsonResponse({ ok: true });
}
