import { z } from 'zod';
import type { ExternalHandoff, LiveSnapshot, ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { assertAllowedRedirect } from '@/lib/redirects';
import { failure, missingConfig, okConfig, unconfiguredHealth, upHealth } from '../base';
import { flightsHandoff } from './deep-link';
import { callJson, CircuitBreaker, GUEST_MESSAGES, type FetchLike } from './http';
import type { FlightResult, FlightSearchRequest, FlightsProvider, HostedSessionRequest } from './types';

/**
 * Duffel Links: a hosted search-and-checkout page Duffel serves under links.duffel.com. We
 * create a session server-side with our reference (the trip item id) and hand the guest over;
 * payment happens on Duffel, never here. The resulting order reaches us through the signed
 * webhook (`duffel-webhook.ts`), which is the only thing that can mark the trip item confirmed
 * without the guest saying so. Field names follow Duffel's Links API and must be re-verified
 * against the current docs when partner access is granted.
 */
export const DUFFEL_BASE_URL = 'https://api.duffel.com';
const SESSIONS_PATH = '/links/sessions';
export const DUFFEL_API_VERSION = 'v2';

export interface DuffelLinksOptions {
  apiKey?: string;
  webhookSecret?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Text Duffel shows at checkout; keep it plain. */
  checkoutDisplayText?: string;
}

const sessionResponse = z.object({ data: z.object({ url: z.string() }) });

export class DuffelLinksFlights implements FlightsProvider {
  readonly kind = 'flights' as const;
  readonly name = 'duffel-links';
  readonly mode: 'live' | 'unavailable';
  readonly capabilities: Record<string, boolean>;
  private readonly breaker = new CircuitBreaker();
  private readonly baseUrl: string;

  constructor(private readonly options: DuffelLinksOptions = {}) {
    this.mode = options.apiKey ? 'live' : 'unavailable';
    this.capabilities = { search: false, deepLink: true, book: false, hostedSession: !!options.apiKey, webhook: !!options.webhookSecret };
    this.baseUrl = (options.baseUrl ?? DUFFEL_BASE_URL).replace(/\/+$/, '');
  }

  validateConfig() {
    const missing = this.options.apiKey ? [] : ['DUFFEL_API_KEY'];
    const warnings = this.options.webhookSecret ? [] : ['DUFFEL_WEBHOOK_SECRET missing: bookings are confirmed only by the guest, never automatically'];
    return missing.length ? missingConfig(missing, warnings) : okConfig(warnings);
  }

  async health() {
    return this.options.apiKey ? upHealth('credentials present; sessions not probed') : unconfiguredHealth('DUFFEL_API_KEY missing');
  }

  deepLink(req: FlightSearchRequest) {
    return flightsHandoff(req);
  }

  /** Duffel Links has no results API of its own: search lives on the hosted page. */
  async search(_req: FlightSearchRequest): Promise<Result<LiveSnapshot<FlightResult[]>, ProviderFailure>> {
    return err(failure(this.name, 'unconfigured', 'Flight search and booking run on Duffel’s secure page; open it to search.'));
  }

  async createHostedSession(req: HostedSessionRequest): Promise<Result<ExternalHandoff, ProviderFailure>> {
    if (!this.options.apiKey) return err(failure(this.name, 'unconfigured', GUEST_MESSAGES.unconfigured));
    const body = {
      data: {
        reference: req.reference,
        success_url: req.successUrl,
        failure_url: req.failureUrl,
        abandonment_url: req.abandonUrl,
        checkout_display_text: this.options.checkoutDisplayText ?? 'Sara + Tyler wedding travel',
        flights: { enabled: true },
        stays: { enabled: false },
        traveller_currency: 'USD',
        markup_amount: '0.00',
        markup_currency: 'USD',
        markup_rate: '0',
        ...(req.origin && req.destination && req.departDate
          ? { search_defaults: { origin: req.origin, destination: req.destination, departure_date: req.departDate, ...(req.returnDate ? { return_date: req.returnDate } : {}), passengers: req.adults ?? 1 } }
          : {}),
      },
    };
    const res = await callJson(
      {
        provider: this.name,
        url: `${this.baseUrl}${SESSIONS_PATH}`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${this.options.apiKey}`, 'duffel-version': DUFFEL_API_VERSION },
          body: JSON.stringify(body),
        },
        timeoutMs: this.options.timeoutMs,
        fetchImpl: this.options.fetchImpl,
        breaker: this.breaker,
      },
      (json) => sessionResponse.parse(json).data.url,
    );
    if (!res.ok) return res;
    const allowed = assertAllowedRedirect(res.value);
    if (!allowed.ok) return err(failure(this.name, 'malformed_response', GUEST_MESSAGES.malformed_response, { raw: { host: 'not allowlisted' } }));
    return ok({
      provider: 'duffel',
      label: 'Continue securely with Duffel',
      url: allowed.value.toString(),
      opensNewTab: false,
      disclosure: 'You will leave our site to search and pay for flights on Duffel’s secure page. We never see your payment details. Come back here afterwards to confirm the booking on your trip.',
    });
  }
}
