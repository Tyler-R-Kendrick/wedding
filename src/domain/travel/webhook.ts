import type { AuditSink } from '@/contracts/audit';
import type { IdempotencyStore } from '@/capabilities/services';
import type { Db } from '@/db/client';
import type { FlightsProvider } from '@/providers/flights/types';
import { stableHash } from '@/lib/crypto';
import { confirmTripItem, findTripItemByReference } from './trip';

/**
 * Inbound booking webhooks (Duffel today). This is the only automatic path to a `confirmed`
 * trip item, and it is trusted solely because the provider signed the payload with the shared
 * secret. Responses are uniform: unsigned/bad signature -> 401, no webhook configured -> 404,
 * accepted-but-ignored -> 202, matched -> 200. Nothing about guests is echoed back.
 *
 * A signature is not a defence against REPLAY. The verifier accepts any correctly signed payload
 * whose timestamp is within five minutes, so anyone who can observe one delivery — a logging
 * proxy, a mirrored request, a leaked log line — can send it again inside that window and have it
 * applied a second time. The state check further down catches the trivial case (the same event on
 * an item already confirmed from the same order) but not the one that matters: a captured OLDER
 * event replayed after a newer one has landed re-confirms the item with the stale flight details,
 * because the provider reference differs and it takes the re-confirm branch. Level 15 makes the
 * event id single-use instead, in the same store the capability pipeline reserves confirmation
 * nonces in. A reservation that is not filled in is released on failure, so a genuine provider
 * retry of a delivery we failed to apply still runs.
 */
export interface WebhookDeps {
  db: Db;
  audit: AuditSink;
  flights: FlightsProvider;
  requestId: string;
  now?: Date;
  /**
   * Single-use store for event ids. REQUIRED, not optional: an optional replay guard is one a
   * caller can forget, and the only caller that matters is a route nobody re-reads. Tests pass
   * `MemoryIdempotencyStore`.
   */
  nonces: IdempotencyStore;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

const ACTOR = { kind: 'system', component: 'travel-webhook' } as const;

/**
 * How long an event id stays claimed. It only has to outlive the window the signature verifier
 * accepts (five minutes), so an hour is slack for clock skew, and the housekeeping purge clears
 * expired rows anyway.
 */
export const WEBHOOK_NONCE_TTL_SECONDS = 60 * 60;

export async function handleBookingWebhook(deps: WebhookDeps, rawBody: string, signatureHeader: string | null): Promise<WebhookResult> {
  const now = deps.now ?? new Date();
  const hook = deps.flights.webhook;
  if (!hook) return { status: 404, body: { ok: false } };
  const verified = hook.verify(rawBody, signatureHeader, now.getTime());
  if (!verified.ok) return { status: 401, body: { ok: false } };

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 202, body: { ok: true, ignored: 'unreadable' } };
  }
  const parsed = hook.parse(json);
  if (!parsed.ok) {
    await deps.audit.record({ actor: ACTOR, action: 'external_action.failed', target: { type: 'webhook', id: deps.flights.name }, outcome: 'failed', requestId: deps.requestId, metadata: { reason: 'malformed' } });
    return { status: 202, body: { ok: true, ignored: 'malformed' } };
  }
  const event = parsed.value;
  if (!event.type.startsWith('order.')) return { status: 202, body: { ok: true, ignored: 'event_type' } };
  if (!event.reference) {
    await deps.audit.record({ actor: ACTOR, action: 'external_action.failed', target: { type: 'webhook', id: event.id }, outcome: 'failed', requestId: deps.requestId, metadata: { reason: 'no_reference', eventType: event.type } });
    return { status: 202, body: { ok: true, matched: false } };
  }
  const item = await findTripItemByReference(deps.db, event.reference);
  if (!item) {
    await deps.audit.record({ actor: ACTOR, action: 'external_action.failed', target: { type: 'webhook', id: event.id }, outcome: 'failed', requestId: deps.requestId, metadata: { reason: 'no_match', eventType: event.type } });
    return { status: 202, body: { ok: true, matched: false } };
  }
  const ref = event.bookingReference ?? event.orderId;
  if (item.status === 'confirmed' && item.confirmedVia === 'webhook' && item.providerRef === ref) {
    return { status: 200, body: { ok: true, matched: true, replay: true } };
  }

  // Every delivery past this point changes a trip item, so the event id is claimed first and for
  // real. `reserve` is INSERT ... ON CONFLICT DO NOTHING: exactly one of any number of concurrent
  // or repeated deliveries of the same id wins. The TTL only has to outlive the signature window
  // the verifier accepts; an hour is generous against clock skew and costs one short-lived row.
  const nonceScope = `webhook:${deps.flights.name}`;
  let claimed: Awaited<ReturnType<IdempotencyStore['reserve']>>;
  try {
    claimed = await deps.nonces.reserve(nonceScope, event.id, stableHash({ reference: event.reference, ref }), WEBHOOK_NONCE_TTL_SECONDS);
  } catch {
    return { status: 500, body: { ok: false } };
  }
  if (!claimed.reserved) {
    await deps.audit.record({ actor: ACTOR, action: 'external_action.failed', target: { type: 'webhook', id: event.id }, outcome: 'denied', requestId: deps.requestId, metadata: { reason: 'replayed_event', eventType: event.type } });
    return { status: 200, body: { ok: true, matched: true, replay: true } };
  }
  const releaseNonce = async () => {
    // A delivery we could not apply must not burn the id: the provider retries failures, and that
    // retry has to be able to run. Only a delivery that actually landed keeps the reservation.
    try {
      await deps.nonces.release(nonceScope, event.id);
    } catch {
      /* the reservation expires on its own; never turn a cleanup failure into a different answer */
    }
  };
  const slice = event.slices[0];
  const startAt = slice?.departAt ? new Date(slice.departAt) : undefined;
  const endAt = slice?.arriveAt ? new Date(slice.arriveAt) : undefined;
  const confirmed = await confirmTripItem(deps.db, {
    id: item.id,
    via: 'webhook',
    now,
    provider: deps.flights.name,
    providerRef: ref,
    details: { origin: slice?.origin, destination: slice?.destination, carrier: slice?.carrier, flightNumber: slice?.flightNumber },
    ...(startAt && Number.isFinite(startAt.getTime()) ? { startAt } : {}),
    ...(endAt && Number.isFinite(endAt.getTime()) ? { endAt } : {}),
  });
  if (!confirmed.ok) {
    await releaseNonce();
    await deps.audit.record({ actor: ACTOR, action: 'external_action.failed', target: { type: 'itinerary_item', id: item.id }, outcome: 'failed', requestId: deps.requestId, metadata: { reason: confirmed.error.code, eventType: event.type } });
    return { status: 202, body: { ok: true, matched: true, applied: false } };
  }
  await deps.audit.record({
    actor: ACTOR,
    action: 'external_action.confirmed',
    target: { type: 'itinerary_item', id: item.id },
    outcome: 'success',
    requestId: deps.requestId,
    metadata: { provider: deps.flights.name, eventType: event.type, via: 'webhook' },
  });
  return { status: 200, body: { ok: true, matched: true, applied: true } };
}
