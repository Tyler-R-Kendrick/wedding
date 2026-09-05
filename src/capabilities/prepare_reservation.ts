import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { recordExternalAction } from '@/domain/external/records';
import { guestHandoffSchema, HH_MM, ISO_DATE, SLUG } from '@/domain/external/schemas';
import { getReservationVenue, reservationOptionFor, venueView } from '@/domain/reservations';
import { appServices } from './context';
import { reservationVenueSchema } from './get_reservation_options';

const input = z.object({
  venueId: z.string().regex(SLUG),
  date: z.string().regex(ISO_DATE),
  time: z.string().regex(HH_MM),
  partySize: z.number().int().min(1).max(20),
  contactName: z.string().trim().min(1).max(80),
});

const output = z.object({
  card: z.object({ venue: reservationVenueSchema, date: z.string(), time: z.string(), partySize: z.number(), contactName: z.string() }),
  rung: z.enum(['api', 'deep-link', 'url', 'unavailable']),
  /** True only when a supported API could commit from this site (no adapter yet: always false). */
  canCommit: z.boolean(),
  nextStep: z.enum(['confirm', 'open_reservation_link', 'ask_us']),
  handoff: guestHandoffSchema.optional(),
  unavailable: z.object({ message: z.string(), contactRoute: z.literal('/ask-us') }).optional(),
});

/**
 * Draft step of the reservation ladder (ADR-0004 §3). It assembles the confirmation card
 * (date / time / party / contact) the guest reviews. When a reservation API can commit, this
 * is where a confirmation token for the commit transaction is issued; until an adapter is
 * contracted `canCommit` is false and the next step is the provider deep link.
 */
export const prepareReservation = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'prepare_reservation',
  title: 'Prepare a reservation',
  description:
    'Builds the card a signed-in guest reviews before reserving a table at a recommended place: date, time, party size and the name for the booking. ' +
    'It tells the guest whether the reservation can be completed here (only with a supported provider API) or continues on the provider’s site. ' +
    'It never books by itself.',
  kind: 'draft',
  auth: 'guest',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 4_000,
  async handler(ctx, i) {
    const { db, providers } = appServices(ctx);
    const venue = await getReservationVenue(db, i.venueId);
    if (!venue) return err(new CapabilityError('not_found', 'We do not have that place on our list.'));
    const option = await reservationOptionFor(providers('reservations'), venue, { date: i.date, partySize: i.partySize });
    const card = { venue: venueView(venue), date: i.date, time: i.time, partySize: i.partySize, contactName: i.contactName };
    // The record carries what was prepared, never the contact name.
    await recordExternalAction(db, ctx.audit, {
      kind: 'reservation_prepare',
      provider: option.handoff?.provider ?? 'none',
      status: 'prepared',
      actor: toPrincipalRef(ctx.principal),
      target: { type: 'reservation_venue', id: venue.id },
      url: option.handoff?.url,
      surface: ctx.surface ?? 'ui',
      requestId: ctx.requestId,
      metadata: { rung: option.rung, partySize: i.partySize, date: i.date },
    });
    const nextStep = option.canCommit ? 'confirm' : option.handoff ? 'open_reservation_link' : 'ask_us';
    return ok({
      data: { card, rung: option.rung, canCommit: option.canCommit, nextStep, handoff: option.handoff, unavailable: option.unavailable },
      sources: [],
      retrievedAt: ctx.now.toISOString(),
    });
  },
});
