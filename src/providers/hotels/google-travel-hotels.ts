import type { LiveSnapshot, ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { failure, okConfig, upHealth } from '../base';
import { CircuitBreaker, GUEST_MESSAGES, type FetchLike } from '../flights/http';
import { searchGoogleTravelHotels } from '../google-travel/hotel-search';
import { assertHotelSearchRequest, partnerHotelHandoffs, venueHotelHandoff } from './deep-link';
import type { HotelResult, HotelSearchRequest, HotelsProvider } from './types';

const TTL_SECONDS = 60 * 60;

function googleHotelsSearchUrl(req: HotelSearchRequest): string {
  assertHotelSearchRequest(req);
  const params = new URLSearchParams({
    q: 'Chicago Loop hotels',
    check_in: req.checkIn,
    check_out: req.checkOut,
    adults: String(req.adults),
    currency: 'USD',
  });
  if (req.children) params.set('children', String(req.children));
  return `https://www.google.com/travel/search?${params.toString()}`;
}
/** Keyless Google Travel Hotels (batchexecute RPC). */
export class GoogleTravelHotels implements HotelsProvider {
  readonly kind = 'hotels' as const;
  readonly name = 'google-travel-hotels';
  readonly mode = 'live' as const;
  readonly capabilities = { search: true, deepLink: true, book: false };
  private readonly breaker = new CircuitBreaker();

  constructor(private readonly options: { fetchImpl?: FetchLike; timeoutMs?: number; now?: () => Date } = {}) {}

  validateConfig() {
    return okConfig();
  }

  async health() {
    return upHealth('keyless Google Travel Hotels RPC');
  }

  deepLink(req: HotelSearchRequest) {
    return {
      provider: 'google.com',
      label: 'Continue on Google Hotels',
      url: googleHotelsSearchUrl(req),
      opensNewTab: true,
      disclosure: 'You will leave our site to compare hotel rates on Google Travel. We never see your payment details.',
    };
  }

  venueHandoff() {
    return venueHotelHandoff();
  }

  extraHandoffs(req: HotelSearchRequest) {
    return [this.deepLink(req), ...partnerHotelHandoffs(req)];
  }

  async search(req: HotelSearchRequest): Promise<Result<LiveSnapshot<HotelResult[]>, ProviderFailure>> {
    if (this.breaker.isOpen) {
      return err(failure(this.name, 'server', GUEST_MESSAGES.server, { retryAfterMs: this.breaker.retryAfterMs }));
    }
    try {
      assertHotelSearchRequest(req);
    } catch (cause) {
      return err(failure(this.name, 'bad_request', GUEST_MESSAGES.bad_request, { raw: cause }));
    }
    try {
      const hits = await searchGoogleTravelHotels(
        {
          query: 'Chicago Athletic Association Hotel',
          checkIn: req.checkIn,
          checkOut: req.checkOut,
          adults: req.adults,
          currency: 'USD',
        },
        { fetchImpl: this.options.fetchImpl as typeof fetch | undefined, timeoutMs: this.options.timeoutMs },
      );
      const pricedAt = (this.options.now ?? (() => new Date()))().toISOString();
      const nights = Math.max(1, Math.round((Date.parse(req.checkOut) - Date.parse(req.checkIn)) / 86_400_000));
      const data: HotelResult[] = hits
        .filter((h) => h.totalUsd !== undefined)
        .map((h, i) => {
          const totalCents = Math.round((h.totalUsd ?? 0) * 100);
          return {
            id: `google-travel-hotel-${i}`,
            name: h.name,
            walkMinutesToVenue: h.walkMinutesToVenue,
            totalCents,
            nightlyCents: Math.round(totalCents / nights),
            currency: 'USD',
            pricedAt,
            bookingUrl: h.bookingUrl && h.bookingUrl.startsWith('https://www.google.com') ? h.bookingUrl : googleHotelsSearchUrl(req),
            ...(h.isVenue ? { isVenue: true } : {}),
          };
        });
      if (!data.length) {
        this.breaker.recordFailure();
        return err(failure(this.name, 'not_found', 'Google Travel has no hotel rates for those dates yet. Try a partner link below.', {}));
      }
      this.breaker.recordSuccess();
      return ok({ provider: this.name, retrievedAt: pricedAt, ttlSeconds: TTL_SECONDS, data });
    } catch (cause) {
      this.breaker.recordFailure();
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (/captcha/i.test(msg)) return err(failure(this.name, 'rate_limited', GUEST_MESSAGES.rate_limited, { retryAfterMs: 60_000, raw: cause }));
      return err(failure(this.name, 'server', GUEST_MESSAGES.server, { raw: cause }));
    }
  }
}

export { googleHotelsSearchUrl };
