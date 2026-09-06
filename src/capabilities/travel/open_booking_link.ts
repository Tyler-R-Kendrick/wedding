import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import type { ExternalHandoff } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import {
  addTripItem,
  externalHandoffOutput,
  flightSearchFields,
  getHotel,
  getTravelLink,
  getTripItemRow,
  getVenueHotel,
  hotelSearchFields,
  iata,
  isoDate,
  linkToHandoff,
  refineFlightSearch,
  refineHotelSearch,
  ulid,
} from '@/domain/travel';
import { publicEnv } from '@/lib/env.public';
import { assertAllowedRedirect } from '@/lib/redirects';
import { CHICAGO_AIRPORTS } from '@/providers/flights/types';
import { assertOwnsRow, providerFromUrl, requireGuestWriter, travelServices } from './_shared';

const input = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flight_search'), ...flightSearchFields }).superRefine(refineFlightSearch),
  z.object({ kind: z.literal('hotel_search'), partner: z.enum(['booking', 'hyatt']).default('booking'), ...hotelSearchFields }).superRefine(refineHotelSearch),
  z.object({ kind: z.literal('venue_block') }),
  z.object({ kind: z.literal('hotel'), hotelId: ulid, checkIn: isoDate.optional(), checkOut: isoDate.optional(), adults: z.number().int().min(1).max(9).default(2) }),
  z.object({ kind: z.literal('travel_link'), linkId: ulid }),
  z.object({
    kind: z.literal('hosted_flights'),
    itineraryItemId: ulid.optional(),
    origin: iata.optional(),
    destination: z.enum(CHICAGO_AIRPORTS).optional(),
    departDate: isoDate.optional(),
    returnDate: isoDate.optional(),
    adults: z.number().int().min(1).max(9).default(1),
  }),
]);
const output = z.object({
  handoff: externalHandoffOutput,
  /** True when the real link (e.g. the room block) is not known yet and this is the best honest fallback. */
  placeholder: z.boolean(),
  /** For hosted flows: the trip item the session is tied to; confirm it on the trip page after booking. */
  itineraryItemId: z.string().optional(),
});

const NO_LINK = 'There is no booking link for that yet. Please check back or ask us.';

export const openBookingLink = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'open_booking_link',
  title: 'Continue to a booking partner',
  description:
    'Builds the explicit hand-off to a booking partner for one target: a flight search (Skyscanner), a hotel search (Booking.com or Hyatt), the venue room block, a recommended hotel, an admin-configured partner link, ' +
    'or a hosted flight checkout (Duffel Links, signed-in guests only). It returns the labelled link and disclosure; it never books, pays, or marks anything confirmed. Every link is checked against the trusted-partner list.',
  kind: 'external',
  auth: 'anonymous',
  requires: [],
  confirmation: 'inline',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 3_000,
  async handler(ctx, i) {
    const s = travelServices(ctx);
    const now = ctx.now;
    let handoff: ExternalHandoff;
    let placeholder = false;
    let itineraryItemId: string | undefined;
    switch (i.kind) {
      case 'flight_search': {
        const { kind: _k, ...req } = i;
        handoff = s.flights.deepLink(req);
        break;
      }
      case 'hotel_search': {
        const { kind: _k, partner, ...req } = i;
        handoff = partner === 'hyatt' ? (s.hotels.extraHandoffs(req).find((h) => h.provider === 'hyatt') ?? s.hotels.deepLink(req)) : s.hotels.deepLink(req);
        break;
      }
      case 'venue_block': {
        const venue = await getVenueHotel(s.db, now);
        if (venue.block?.url) {
          handoff = { provider: providerFromUrl(venue.block.url), label: `Book in the ${venue.name} block`, url: venue.block.url, opensNewTab: true, disclosure: 'You will leave our site to book with the hotel at the group rate. We never see your payment details.' };
          placeholder = venue.block.placeholder;
        } else {
          handoff = s.hotels.venueHandoff();
          placeholder = true;
        }
        break;
      }
      case 'hotel': {
        const hotel = await getHotel(s.db, i.hotelId, now);
        if (!hotel || !hotel.active) return err(new CapabilityError('not_found', 'That hotel is not on our list.'));
        if (hotel.bookingUrl) {
          handoff = { provider: providerFromUrl(hotel.bookingUrl), label: `Book ${hotel.name}`, url: hotel.bookingUrl, opensNewTab: true, disclosure: `You will leave our site to book ${hotel.name}. We never see your payment details.` };
        } else if (i.checkIn && i.checkOut && i.checkOut > i.checkIn) {
          handoff = s.hotels.deepLink({ checkIn: i.checkIn, checkOut: i.checkOut, adults: i.adults, area: `${hotel.name}, Chicago` });
          handoff = { ...handoff, label: `Search ${hotel.name} on Booking.com` };
        } else if (hotel.websiteUrl) {
          handoff = { provider: providerFromUrl(hotel.websiteUrl), label: `Visit ${hotel.name}`, url: hotel.websiteUrl, opensNewTab: true, disclosure: 'Opens the hotel website in a new tab.' };
        } else {
          return err(new CapabilityError('provider_unavailable', NO_LINK, { provider: 'hotels' }));
        }
        placeholder = hotel.placeholder;
        break;
      }
      case 'travel_link': {
        const link = await getTravelLink(s.db, i.linkId);
        if (!link || !link.active) return err(new CapabilityError('not_found', 'That link is no longer available.'));
        handoff = linkToHandoff(link);
        break;
      }
      case 'hosted_flights': {
        const hosted = await hostedFlights(ctx, s, i);
        if (!hosted.ok) return err(hosted.error);
        handoff = hosted.value.handoff;
        itineraryItemId = hosted.value.itineraryItemId;
        break;
      }
    }
    const allowed = assertAllowedRedirect(handoff.url);
    if (!allowed.ok) return err(allowed.error);
    await ctx.audit.record({
      actor: toPrincipalRef(ctx.principal),
      action: 'external_action.initiated',
      target: { type: 'handoff', id: handoff.provider },
      outcome: 'success',
      requestId: ctx.requestId,
      metadata: { kind: i.kind, placeholder },
    });
    return ok({ data: { handoff, placeholder, ...(itineraryItemId ? { itineraryItemId } : {}) }, sources: [], handoffUrl: handoff.url });
  },
});

type HostedInput = Extract<z.infer<typeof input>, { kind: 'hosted_flights' }>;

async function hostedFlights(ctx: Parameters<typeof openBookingLink.handler>[0], s: ReturnType<typeof travelServices>, i: HostedInput): Promise<Result<{ handoff: ExternalHandoff; itineraryItemId: string }, CapabilityError>> {
  const writer = requireGuestWriter(ctx);
  if (!writer.ok) return err(writer.error);
  if (!s.flights.createHostedSession) {
    return err(new CapabilityError('provider_unavailable', 'Booking on our site is not set up; use the search link to book with the partner directly.', { provider: s.flights.name }));
  }
  let itemId = i.itineraryItemId;
  if (itemId) {
    const row = await getTripItemRow(s.db, itemId);
    if (!row) return err(new CapabilityError('not_found', 'That trip item was not found.'));
    const owns = assertOwnsRow(ctx, row.guestId);
    if (!owns.ok) return err(owns.error);
  } else {
    const created = await addTripItem(s.db, {
      guestId: writer.value.guestId,
      householdId: writer.value.householdId,
      actor: toPrincipalRef(ctx.principal),
      now: ctx.now,
      input: {
        kind: 'flight',
        title: i.origin ? `Flights ${i.origin} to ${i.destination ?? 'ORD'}` : 'Flights to Chicago',
        startAt: i.departDate ?? '2027-07-16',
        endAt: undefined,
        timezone: 'America/Chicago',
        provider: s.flights.name,
        providerRef: undefined,
        details: { ...(i.origin ? { origin: i.origin } : {}), destination: i.destination ?? 'ORD' },
      },
    });
    if (!created.ok) return err(created.error);
    itemId = created.value.id;
  }
  const base = publicEnv.siteUrl.replace(/\/+$/, '');
  const session = await s.flights.createHostedSession({
    reference: itemId,
    successUrl: `${base}/trip?ref=${itemId}&outcome=success`,
    failureUrl: `${base}/trip?ref=${itemId}&outcome=failure`,
    abandonUrl: `${base}/trip?ref=${itemId}&outcome=abandoned`,
    origin: i.origin,
    destination: i.destination,
    departDate: i.departDate,
    returnDate: i.returnDate,
    adults: i.adults,
  });
  if (!session.ok) {
    const f = session.error;
    return err(new CapabilityError(f.class === 'rate_limited' ? 'rate_limited' : 'provider_unavailable', f.message, { provider: f.provider, ...(f.retryAfterMs ? { retryAfterMs: f.retryAfterMs } : {}) }, f.raw));
  }
  return ok({ handoff: session.value, itineraryItemId: itemId });
}
