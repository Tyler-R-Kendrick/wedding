import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { guestHandoffSchema, ISO_DATE, SLUG } from '@/domain/external/schemas';
import { reservationOptions } from '@/domain/reservations';
import { appServices } from './context';

const input = z
  .object({
    venueId: z.string().regex(SLUG).optional(),
    date: z.string().regex(ISO_DATE).optional(),
    partySize: z.number().int().min(1).max(20).optional(),
  })
  .optional();

export const reservationVenueSchema = z.object({
  id: z.string(),
  name: z.string(),
  note: z.string().nullable(),
  placeholder: z.boolean(),
  verifiedAt: z.string().nullable(),
  sourceId: z.string().nullable(),
});

export const reservationOptionSchema = z.object({
  venue: reservationVenueSchema,
  rung: z.enum(['api', 'deep-link', 'url', 'unavailable']),
  canCommit: z.boolean(),
  handoff: guestHandoffSchema.optional(),
  unavailable: z.object({ message: z.string(), contactRoute: z.literal('/ask-us') }).optional(),
});

const output = z.object({ options: z.array(reservationOptionSchema) });

export type ReservationOptionsOutput = z.infer<typeof output>;

export const getReservationOptions = defineCapability<z.infer<typeof input>, ReservationOptionsOutput>({
  name: 'get_reservation_options',
  title: 'Reservation options',
  description:
    'For a restaurant or outlet the couple recommend, tells you how a table can be reserved: through a provider deep link (Resy, OpenTable), ' +
    'the place’s own booking page, or honestly "not available yet" with how to ask the couple. Optional date and party size are passed into deep links. ' +
    'Reads only; it never books.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 8_000,
  async handler(ctx, i) {
    const { db, providers } = appServices(ctx);
    const result = await reservationOptions(db, providers('reservations'), i ?? {});
    if (!result) return err(new CapabilityError('not_found', 'We do not have that place on our list.'));
    return ok({ data: { options: result.options }, sources: result.sources, retrievedAt: ctx.now.toISOString() });
  },
});
