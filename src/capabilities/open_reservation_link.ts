import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { recordExternalAction } from '@/domain/external/records';
import { ISO_DATE, SLUG } from '@/domain/external/schemas';
import { getReservationVenue, reservationOptionFor } from '@/domain/reservations';
import { appServices } from './context';
import { reservationOptionSchema } from './get_reservation_options';

const input = z.object({
  venueId: z.string().regex(SLUG),
  date: z.string().regex(ISO_DATE).optional(),
  partySize: z.number().int().min(1).max(20).optional(),
});

const output = reservationOptionSchema.extend({ externalActionId: z.string().optional() });

/**
 * Explicit handoff to the reservation provider (deep link or the place's own page). Honest
 * on the last rung: returns `unavailable` with the couple's contact route instead of a fake
 * button. Not idempotent (anonymous visitors cannot hold keys; a record of a link handed over
 * is never a commitment).
 */
export const openReservationLink = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'open_reservation_link',
  title: 'Open a reservation link',
  description:
    'Hands the guest off to reserve a table at a recommended place: a Resy or OpenTable deep link (with date and party size when given) or the place’s ' +
    'own booking page, opened in a new tab. Use it when the guest wants to reserve. It records the handoff and never books, pays, or confirms anything.',
  kind: 'external',
  auth: 'anonymous',
  requires: [],
  confirmation: 'inline',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 3_000,
  async handler(ctx, i) {
    const { db, providers } = appServices(ctx);
    const venue = await getReservationVenue(db, i.venueId);
    if (!venue) return err(new CapabilityError('not_found', 'We do not have that place on our list.'));
    const option = await reservationOptionFor(providers('reservations'), venue, { date: i.date, partySize: i.partySize });
    if (!option.handoff) return ok({ data: option, sources: [], retrievedAt: ctx.now.toISOString() });
    const externalActionId = await recordExternalAction(db, ctx.audit, {
      kind: 'reservation_link',
      provider: option.handoff.provider,
      status: 'initiated',
      actor: toPrincipalRef(ctx.principal),
      target: { type: 'reservation_venue', id: venue.id },
      url: option.handoff.url,
      surface: ctx.surface ?? 'ui',
      requestId: ctx.requestId,
      metadata: { rung: option.rung, ...(i.partySize ? { partySize: i.partySize } : {}), ...(i.date ? { date: i.date } : {}) },
    });
    return ok({ data: { ...option, externalActionId }, sources: [], handoffUrl: option.handoff.url, retrievedAt: ctx.now.toISOString() });
  },
});
