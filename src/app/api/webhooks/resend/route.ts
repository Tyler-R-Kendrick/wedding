import { getDb } from '@/db/client';
import { handleResendInboundWebhook } from '@/domain/inbound-mail/webhook';
import { env } from '@/lib/env';
import { DbIdempotencyStore } from '@/lib/idempotency';
import { getClientIp, getRequestId, jsonResponse, readBodyText } from '@/lib/request';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;

/**
 * POST /api/webhooks/resend — Resend inbound `email.received` events.
 * Verifies the Svix signature, loads the received message through Resend's receiving API,
 * and forwards mail for hello@kendrick.wedding to the planner (PLANNER_FORWARD_EMAIL).
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const db = await getDb();
  const limiter = getProvider('rate-limit', { db });
  const ip = getClientIp(request.headers, env.TRUSTED_PROXY_HOPS);
  const raw = await readBodyText(request, MAX_BODY_BYTES);
  if (!raw.ok) return jsonResponse({ ok: false }, { status: 413, requestId });

  const result = await handleResendInboundWebhook(
    {
      webhookSecret: env.RESEND_WEBHOOK_SECRET,
      config: {
        connectUserId: env.RESEND_CONNECT_USER_ID ?? '',
        emailFrom: env.EMAIL_FROM ?? '',
        plannerForwardEmails: env.PLANNER_FORWARD_EMAIL,
      },
      nonces: new DbIdempotencyStore(db),
      limiter,
    },
    raw.value,
    {
      svixId: request.headers.get('svix-id'),
      svixTimestamp: request.headers.get('svix-timestamp'),
      svixSignature: request.headers.get('svix-signature'),
    },
    ip,
  );
  return jsonResponse(result.body, { status: result.status, requestId });
}

export async function GET() {
  return jsonResponse({ ok: false }, { status: 405, headers: { Allow: 'POST' } });
}
