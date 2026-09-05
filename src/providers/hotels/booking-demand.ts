import { z } from 'zod';
import type { LiveSnapshot, ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { failure, missingConfig, okConfig, unconfiguredHealth, upHealth } from '../base';
import { callJson, CircuitBreaker, GUEST_MESSAGES, toCents, type FetchLike } from '../flights/http';
import { assertHotelSearchRequest, bookingComUrl, hotelsHandoff, venueHotelHandoff, VENUE_SEARCH_CENTER } from './deep-link';
import type { HotelResult, HotelSearchRequest, HotelsProvider } from './types';

/**
 * Booking.com Demand API seam (`POST /3.1/accommodations/search`, bearer token + affiliate id).
 * Partner access is not confirmed; shapes are zod-guarded and drift degrades to the deep-link
 * rung. Rates are snapshots with a short TTL; the booking handoff is a Booking.com deep link.
 */
export const BOOKING_DEMAND_BASE_URL = 'https://demandapi.booking.com';
const SEARCH_PATH = '/3.1/accommodations/search';
const TTL_SECONDS = 10 * 60;

export interface BookingDemandOptions {
  apiKey?: string;
  affiliateId?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}

const accommodation = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().optional(),
  currency: z.string().optional(),
  price: z.object({ book: z.union([z.string(), z.number()]).optional(), total: z.union([z.string(), z.number()]).optional() }).optional(),
  location: z.object({ address: z.string().optional(), city: z.string().optional() }).optional(),
  url: z.string().optional(),
});
const response = z.object({ data: z.array(accommodation).optional() });

export class BookingDemandHotels implements HotelsProvider {
  readonly kind = 'hotels' as const;
  readonly name = 'booking-demand';
  readonly mode: 'live' | 'unavailable';
  readonly capabilities: Record<string, boolean>;
  private readonly breaker = new CircuitBreaker();
  private readonly baseUrl: string;

  constructor(private readonly options: BookingDemandOptions = {}) {
    const configured = !!(options.apiKey && options.affiliateId);
    this.mode = configured ? 'live' : 'unavailable';
    this.capabilities = { search: configured, deepLink: true, book: false };
    this.baseUrl = (options.baseUrl ?? BOOKING_DEMAND_BASE_URL).replace(/\/+$/, '');
  }

  validateConfig() {
    const missing = [...(this.options.apiKey ? [] : ['BOOKING_DEMAND_API_KEY']), ...(this.options.affiliateId ? [] : ['BOOKING_AFFILIATE_ID'])];
    return missing.length ? missingConfig(missing) : okConfig();
  }

  async health() {
    return this.capabilities.search ? upHealth('credentials present; search not probed') : unconfiguredHealth('Booking.com Demand API credentials missing');
  }

  deepLink(req: HotelSearchRequest) {
    return hotelsHandoff(req);
  }

  venueHandoff() {
    return venueHotelHandoff();
  }

  async search(req: HotelSearchRequest): Promise<Result<LiveSnapshot<HotelResult[]>, ProviderFailure>> {
    if (!this.capabilities.search) return err(failure(this.name, 'unconfigured', GUEST_MESSAGES.unconfigured));
    try {
      assertHotelSearchRequest(req);
    } catch (cause) {
      return err(failure(this.name, 'bad_request', GUEST_MESSAGES.bad_request, { raw: cause }));
    }
    const body = {
      booker: { country: 'us', platform: 'desktop' },
      checkin: req.checkIn,
      checkout: req.checkOut,
      guests: { number_of_adults: req.adults, number_of_rooms: req.rooms ?? 1, children: Array.from({ length: req.children ?? 0 }, () => 10) },
      coordinates: { latitude: VENUE_SEARCH_CENTER.latitude, longitude: VENUE_SEARCH_CENTER.longitude, radius: VENUE_SEARCH_CENTER.radiusKm },
      currency: 'USD',
      extras: ['extra_charges'],
      rows: 20,
    };
    const res = await callJson(
      {
        provider: this.name,
        url: `${this.baseUrl}${SEARCH_PATH}`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${this.options.apiKey}`, 'x-affiliate-id': this.options.affiliateId ?? '' },
          body: JSON.stringify(body),
        },
        timeoutMs: this.options.timeoutMs,
        fetchImpl: this.options.fetchImpl,
        breaker: this.breaker,
      },
      (json) => response.parse(json),
    );
    if (!res.ok) return res;
    const pricedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const nights = Math.max(1, Math.round((Date.parse(req.checkOut) - Date.parse(req.checkIn)) / 86_400_000));
    const searchUrl = bookingComUrl(req);
    const data: HotelResult[] = (res.value.data ?? []).map((a) => {
      const total = toCents(a.price?.total ?? a.price?.book);
      return {
        id: `booking-${a.id}`,
        name: a.name ?? `Booking.com property ${a.id}`,
        address: a.location?.address,
        ...(total !== undefined ? { totalCents: total, nightlyCents: Math.round(total / nights), currency: a.currency ?? 'USD', pricedAt } : {}),
        bookingUrl: searchUrl,
      };
    });
    data.sort((a, b) => (a.totalCents ?? Number.MAX_SAFE_INTEGER) - (b.totalCents ?? Number.MAX_SAFE_INTEGER));
    return ok({ provider: this.name, retrievedAt: pricedAt, ttlSeconds: TTL_SECONDS, data });
  }
}
