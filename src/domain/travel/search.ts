import type { ExternalHandoff } from '@/contracts/providers';
import type { Db } from '@/db/client';
import { assertAllowedRedirect } from '@/lib/redirects';
import type { FlightSearchRequest, FlightsProvider } from '@/providers/flights/types';
import type { HotelSearchRequest, HotelsProvider } from '@/providers/hotels/types';
import { AIRPORTS } from './facts';
import { linkToHandoff, listTravelLinks } from './links';
import { snapshotExpiresAt, transferLabel } from './snapshot';
import type { FlightSearchInput, FlightSearchOutcome, HotelSearchInput, HotelSearchOutcome } from './types';

/**
 * Search orchestration: explicit user action only (capabilities call this; pages never do on
 * load). The fallback ladder is applied here: live snapshot -> provider deep link (+ Hyatt) ->
 * admin-configured links -> honest notice. Every URL that leaves passes the redirect allowlist.
 */
export interface SearchDeps {
  db: Db;
  now: Date;
  flights?: FlightsProvider;
  hotels?: HotelsProvider;
  warn?: (obj: Record<string, unknown>, msg: string) => void;
}

const allowed = (handoff: ExternalHandoff): boolean => assertAllowedRedirect(handoff.url).ok;

export async function searchFlights(deps: SearchDeps, input: FlightSearchInput): Promise<FlightSearchOutcome> {
  const provider = deps.flights;
  const req: FlightSearchRequest = {
    origin: input.origin,
    destination: input.destination,
    departDate: input.departDate,
    returnDate: input.returnDate,
    adults: input.adults,
    children: input.children,
    cabin: input.cabin,
    nonstopOnly: input.nonstopOnly,
  };
  const airports = AIRPORTS.map((a) => ({ ...a }));
  const request = { origin: req.origin, destination: req.destination ?? 'ORD', departDate: req.departDate, returnDate: req.returnDate, adults: req.adults, children: req.children ?? 0, cabin: req.cabin ?? 'economy', nonstopOnly: req.nonstopOnly ?? false };
  const adminLinks = (await listTravelLinks(deps.db, { categories: ['airline', 'ota'] })).map(linkToHandoff);
  if (!provider) {
    return { kind: 'flights', mode: 'unavailable', provider: 'none', request, airports, handoffs: adminLinks.filter(allowed), notice: 'Flight search is not set up yet.' };
  }
  const handoffs = [provider.deepLink(req), ...adminLinks].filter(allowed);
  const result = await provider.search(req);
  if (!result.ok) {
    const f = result.error;
    deps.warn?.({ provider: f.provider, class: f.class }, 'flight search fell back to deep links');
    return {
      kind: 'flights',
      mode: f.class === 'unconfigured' ? 'deep-link' : 'deep-link',
      provider: provider.name,
      request,
      airports,
      handoffs,
      notice: f.message,
      ...(f.retryAfterMs ? { retryAfterMs: Math.ceil(f.retryAfterMs) } : {}),
    };
  }
  const snap = result.value;
  const results = snap.data.map((r) => {
    const t = transferLabel(r.transfer);
    const bookingUrl = r.bookingUrl && assertAllowedRedirect(r.bookingUrl).ok ? r.bookingUrl : undefined;
    return {
      id: r.id,
      carrier: r.carrier,
      carrierCode: r.carrierCode,
      origin: r.origin,
      destination: r.destination,
      departAt: r.departAt,
      arriveAt: r.arriveAt,
      durationMinutes: r.durationMinutes,
      stops: r.stops,
      transfer: r.transfer,
      transferLabel: t.label,
      ...(t.caution ? { transferCaution: t.caution } : {}),
      ...(r.segments ? { segments: r.segments } : {}),
      ...(r.priceCents !== undefined ? { priceCents: r.priceCents, currency: r.currency ?? 'USD', pricedAt: r.pricedAt ?? snap.retrievedAt } : {}),
      ...(bookingUrl ? { bookingUrl, bookingProvider: r.bookingProvider ?? provider.name } : {}),
    };
  });
  return {
    kind: 'flights',
    mode: 'live',
    provider: snap.provider,
    request,
    airports,
    snapshot: { provider: snap.provider, retrievedAt: snap.retrievedAt, ttlSeconds: snap.ttlSeconds, expiresAt: snapshotExpiresAt(snap), refreshBeforeBooking: true, results },
    handoffs,
  };
}

export async function searchHotels(deps: SearchDeps, input: HotelSearchInput): Promise<HotelSearchOutcome> {
  const provider = deps.hotels;
  const req: HotelSearchRequest = { checkIn: input.checkIn, checkOut: input.checkOut, adults: input.adults, children: input.children, rooms: input.rooms };
  const request = { checkIn: req.checkIn, checkOut: req.checkOut, adults: req.adults, children: req.children ?? 0, rooms: req.rooms ?? 1 };
  const adminLinks = (await listTravelLinks(deps.db, { categories: ['hotel'] })).map(linkToHandoff);
  if (!provider) {
    return { kind: 'hotels', mode: 'unavailable', provider: 'none', request, handoffs: adminLinks.filter(allowed), notice: 'Hotel search is not set up yet.' };
  }
  const handoffs = [provider.deepLink(req), ...provider.extraHandoffs(req), ...adminLinks].filter(allowed);
  const result = await provider.search(req);
  if (!result.ok) {
    const f = result.error;
    deps.warn?.({ provider: f.provider, class: f.class }, 'hotel search fell back to deep links');
    return { kind: 'hotels', mode: 'deep-link', provider: provider.name, request, handoffs, notice: f.message, ...(f.retryAfterMs ? { retryAfterMs: Math.ceil(f.retryAfterMs) } : {}) };
  }
  const snap = result.value;
  const results = snap.data.map((h) => ({
    id: h.id,
    name: h.name,
    ...(h.address ? { address: h.address } : {}),
    ...(h.walkMinutesToVenue !== undefined ? { walkMinutesToVenue: h.walkMinutesToVenue } : {}),
    ...(h.nightlyCents !== undefined ? { nightlyCents: h.nightlyCents } : {}),
    ...(h.totalCents !== undefined ? { totalCents: h.totalCents } : {}),
    ...(h.currency ? { currency: h.currency } : {}),
    ...(h.nightlyCents !== undefined || h.totalCents !== undefined ? { pricedAt: h.pricedAt ?? snap.retrievedAt } : {}),
    ...(h.bookingUrl && assertAllowedRedirect(h.bookingUrl).ok ? { bookingUrl: h.bookingUrl } : {}),
    ...(h.isVenue ? { isVenue: true } : {}),
  }));
  return {
    kind: 'hotels',
    mode: 'live',
    provider: snap.provider,
    request,
    snapshot: { provider: snap.provider, retrievedAt: snap.retrievedAt, ttlSeconds: snap.ttlSeconds, expiresAt: snapshotExpiresAt(snap), refreshBeforeBooking: true, results },
    handoffs,
  };
}
