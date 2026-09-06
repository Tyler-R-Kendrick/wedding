import type { AuditSink } from '@/contracts/audit';
import type { Db } from '@/db/client';
import type { FlightsProvider } from '@/providers/flights/types';
import { confirmTripItem, findTripItemByReference } from './trip';

/**
 * Inbound booking webhooks (Duffel today). This is the only automatic path to a `confirmed`
 * trip item, and it is trusted solely because the provider signed the payload with the shared
 * secret. Responses are uniform: unsigned/bad signature -> 401, no webhook configured -> 404,
 * accepted-but-ignored -> 202, matched -> 200. Nothing about guests is echoed back.
 */
export interface WebhookDeps {
  db: Db;
  audit: AuditSink;
  flights: FlightsProvider;
  requestId: string;
  now?: Date;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

const ACTOR = { kind: 'system', component: 'travel-webhook' } as const;

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
