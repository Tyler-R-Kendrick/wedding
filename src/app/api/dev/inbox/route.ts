import { env } from '@/lib/env';
import { jsonResponse } from '@/lib/request';
import { devInbox } from '@/providers/auth-email/mock';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';

/** Development only: shows OTP emails captured by the mock auth-email provider. 404 in production or when a real mailer is configured. */
function available(): boolean {
  return !env.isProduction && getProvider('auth-email').name === 'mock';
}

export async function GET() {
  if (!available()) return new Response(null, { status: 404 });
  return jsonResponse({ messages: devInbox.list() });
}

export async function DELETE() {
  if (!available()) return new Response(null, { status: 404 });
  devInbox.clear();
  return jsonResponse({ ok: true });
}
