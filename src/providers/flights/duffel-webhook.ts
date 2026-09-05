import { z } from 'zod';
import type { ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { hmacSha256, timingSafeEqualString } from '@/lib/crypto';
import { failure } from '../base';

/**
 * Duffel webhook verification and event parsing (pure; no I/O). The signature header is
 * `X-Duffel-Signature: t=<unix seconds>,v1=<hex hmac-sha256(secret, "<t>.<raw body>")>`.
 * Anything malformed, unsigned, stale, or unrecognised is rejected; the route answers with a
 * uniform 401 so probes learn nothing. Re-verify the exact scheme against Duffel's docs when
 * partner access is granted (brief: "implementation-ready").
 */
const PROVIDER = 'duffel';
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface DuffelOrderEvent {
  id: string;
  type: string;
  createdAt: string;
  order: {
    id: string;
    bookingReference?: string;
    /** The Links session reference we created (our itinerary item id), when Duffel echoes it. */
    reference?: string;
    metadata: Record<string, string>;
    slices: Array<{ origin?: string; destination?: string; departAt?: string; arriveAt?: string; carrier?: string; flightNumber?: string }>;
  };
}

/** Test helper + reference implementation of the signing scheme. */
export function signDuffelPayload(secret: string, rawBody: string, timestampSeconds: number): string {
  const hex = Buffer.from(hmacSha256(secret, `${timestampSeconds}.${rawBody}`), 'base64url').toString('hex');
  return `t=${timestampSeconds},v1=${hex}`;
}

export function verifyDuffelSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string | undefined,
  now: number = Date.now(),
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): Result<void, ProviderFailure> {
  if (!secret) return err(failure(PROVIDER, 'unconfigured', 'Webhook secret not configured.'));
  if (!header) return err(failure(PROVIDER, 'auth', 'Missing signature.'));
  const parts = Object.fromEntries(
    header
      .split(',')
      .map((p) => p.trim().split('='))
      .filter((kv): kv is [string, string] => kv.length === 2),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return err(failure(PROVIDER, 'auth', 'Malformed signature.'));
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return err(failure(PROVIDER, 'auth', 'Stale signature.'));
  const expected = signDuffelPayload(secret, rawBody, t).slice(`t=${t},v1=`.length);
  if (!timingSafeEqualString(expected.toLowerCase(), v1.toLowerCase())) return err(failure(PROVIDER, 'auth', 'Bad signature.'));
  return ok(undefined);
}

const place = z.union([z.string(), z.object({ iata_code: z.string().optional(), name: z.string().optional() })]);
const segment = z.object({
  origin: place.optional(),
  destination: place.optional(),
  departing_at: z.string().optional(),
  arriving_at: z.string().optional(),
  marketing_carrier: z.object({ name: z.string().optional(), iata_code: z.string().optional() }).optional(),
  marketing_carrier_flight_number: z.string().optional(),
});
const slice = z.object({ origin: place.optional(), destination: place.optional(), segments: z.array(segment).optional() });
const order = z.object({
  id: z.string(),
  booking_reference: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional().nullable(),
  slices: z.array(slice).optional(),
});
const event = z.object({
  id: z.string(),
  type: z.string(),
  created_at: z.string().optional(),
  data: z.object({ object: order }),
});

const placeCode = (p: z.infer<typeof place> | undefined) => (typeof p === 'string' ? p : p?.iata_code ?? p?.name);

/** Parses an `order.*` event. Unknown shapes are `malformed_response`; other event types are accepted and ignored by the domain. */
export function parseDuffelEvent(body: unknown): Result<DuffelOrderEvent, ProviderFailure> {
  const parsed = event.safeParse(body);
  if (!parsed.success) return err(failure(PROVIDER, 'malformed_response', 'Unrecognised webhook payload.', { raw: parsed.error.issues.length }));
  const o = parsed.data.data.object;
  const metadata = o.metadata ?? {};
  const reference = metadata.reference ?? metadata.duffel_links_session_reference ?? metadata.itinerary_item_id;
  return ok({
    id: parsed.data.id,
    type: parsed.data.type,
    createdAt: parsed.data.created_at ?? new Date().toISOString(),
    order: {
      id: o.id,
      bookingReference: o.booking_reference,
      reference,
      metadata,
      slices: (o.slices ?? []).map((s) => {
        const first = s.segments?.[0];
        const last = s.segments?.[s.segments.length - 1];
        return {
          origin: placeCode(s.origin) ?? placeCode(first?.origin),
          destination: placeCode(s.destination) ?? placeCode(last?.destination),
          departAt: first?.departing_at,
          arriveAt: last?.arriving_at,
          carrier: first?.marketing_carrier?.name,
          flightNumber: first?.marketing_carrier?.iata_code && first?.marketing_carrier_flight_number ? `${first.marketing_carrier.iata_code}${first.marketing_carrier_flight_number}` : undefined,
        };
      }),
    },
  });
}
