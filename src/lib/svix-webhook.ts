import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SvixHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

function decodeSecret(webhookSecret: string): Buffer {
  const raw = webhookSecret.startsWith('whsec_') ? webhookSecret.slice('whsec_'.length) : webhookSecret;
  return Buffer.from(raw, 'base64');
}

/** Standard Webhooks / Svix signature verification (used by Resend inbound webhooks). */
export function verifySvixWebhook(
  payload: string,
  headers: SvixHeaders,
  webhookSecret: string,
  nowMs = Date.now(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): { ok: true } | { ok: false; reason: 'timestamp' | 'signature' | 'missing' } {
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: 'missing' };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSeconds) return { ok: false, reason: 'timestamp' };

  const signedContent = `${headers.id}.${headers.timestamp}.${payload}`;
  const key = decodeSecret(webhookSecret);
  const expected = createHmac('sha256', key).update(signedContent).digest('base64');

  const candidates = headers.signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice(3));

  for (const candidate of candidates) {
    try {
      const a = Buffer.from(expected, 'base64');
      const b = Buffer.from(candidate, 'base64');
      if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true };
    } catch {
      // malformed base64 in header
    }
  }
  return { ok: false, reason: 'signature' };
}

/** Test helper: build a valid Svix signature header for a payload. */
export function signSvixPayload(webhookSecret: string, id: string, timestampSeconds: number, payload: string): string {
  const key = decodeSecret(webhookSecret);
  const signedContent = `${id}.${timestampSeconds}.${payload}`;
  const sig = createHmac('sha256', key).update(signedContent).digest('base64');
  return `v1,${sig}`;
}
