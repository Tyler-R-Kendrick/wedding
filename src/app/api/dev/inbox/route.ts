import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';
import { bearerToken, jsonResponse } from '@/lib/request';
import { devInbox } from '@/providers/auth-email/mock';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';

/**
 * Development only: shows OTP emails captured by the mock auth-email provider (the inbox is
 * empty whenever a real mailer is configured). Reachable on a local development server only,
 * never on a shared host (Vercel, CI) unless the caller presents DEV_INBOX_TOKEN.
 */
function available(request: Request): boolean {
  if (getProvider('auth-email').name !== 'mock') return false;
  const token = bearerToken(request);
  if (env.DEV_INBOX_TOKEN && token && timingSafeEqualString(token, env.DEV_INBOX_TOKEN)) return true;
  return env.isDevelopment && !process.env.VERCEL && !process.env.CI;
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
