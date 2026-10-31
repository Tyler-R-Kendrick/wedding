import { z } from 'zod';
import type { IdempotencyStore } from '@/capabilities/services';
import type { RateLimitProvider } from '@/providers/rate-limit/types';
import { verifySvixWebhook } from '@/lib/svix-webhook';
import { sha256Hex } from '@/lib/crypto';
import { forwardGuestEmail, type InboundForwardConfig } from './forward';

const emailReceivedEvent = z.object({
  type: z.literal('email.received'),
  data: z.object({
    email_id: z.string().min(1),
    from: z.string().min(1),
    to: z.union([z.array(z.string()), z.string()]).transform((v) => (Array.isArray(v) ? v : [v])),
    subject: z.string().optional().nullable(),
  }),
});

export interface InboundWebhookDeps {
  webhookSecret?: string;
  config: InboundForwardConfig;
  nonces: IdempotencyStore;
  limiter: RateLimitProvider;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export async function handleResendInboundWebhook(
  deps: InboundWebhookDeps,
  rawBody: string,
  headers: { svixId: string | null; svixTimestamp: string | null; svixSignature: string | null },
  clientIp: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!deps.webhookSecret || !deps.config.plannerForwardEmail || !deps.config.connectUserId || !deps.config.emailFrom) {
    return { status: 404, body: { ok: false } };
  }

  const ipDecision = await deps.limiter.consume(`webhook:ip:${clientIp}`, 'capabilityIp');
  if (!ipDecision.allowed) return { status: 429, body: { ok: false } };

  const verified = verifySvixWebhook(
    rawBody,
    {
      id: headers.svixId ?? '',
      timestamp: headers.svixTimestamp ?? '',
      signature: headers.svixSignature ?? '',
    },
    deps.webhookSecret,
    (deps.now ?? (() => new Date()))().getTime(),
  );
  if (!verified.ok) return { status: 401, body: { ok: false } };

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 202, body: { ok: true, ignored: 'unreadable' } };
  }

  const parsed = emailReceivedEvent.safeParse(json);
  if (!parsed.success) return { status: 202, body: { ok: true, ignored: 'event_type' } };

  const sender = parsed.data.data.from;
  const senderKey = `inbound-mail:sender:${sha256Hex(sender.toLowerCase())}`;
  const consumeSenderLimit = async (key: string) => {
    const decision = await deps.limiter.consume(key, 'inboundMailSender');
    return decision.allowed;
  };

  return forwardGuestEmail(
    { config: deps.config, nonces: deps.nonces, fetchImpl: deps.fetchImpl, now: deps.now },
    {
      emailId: parsed.data.data.email_id,
      from: parsed.data.data.from,
      to: parsed.data.data.to,
      subject: parsed.data.data.subject,
      svixId: headers.svixId ?? parsed.data.data.email_id,
    },
    senderKey,
    consumeSenderLimit,
  );
}
