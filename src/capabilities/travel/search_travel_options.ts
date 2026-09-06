import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { BRIEF_CITATION, searchFlights, searchHotels, travelSearchInput, travelSearchOutput, type TravelSearchInput, type TravelSearchOutcome } from '@/domain/travel';
import { travelServices } from './_shared';

export const searchTravelOptions = defineCapability<TravelSearchInput, TravelSearchOutcome>({
  name: 'search_travel_options',
  title: 'Search flights or hotels',
  description:
    'Searches flights into Chicago (ORD or MDW) or hotels near the Chicago Athletic Association for given dates and travellers. Only call it when the guest explicitly asks to search; never on page load. ' +
    'Results are a timestamped snapshot from a partner (mode "live") that must be refreshed before booking; when no live partner is available (mode "deep-link") it returns partner links to continue the search instead. ' +
    'Every price is the partner’s, and the final price is always the one shown at the partner’s checkout. It never books or pays.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  flag: 'TRAVEL_LIVE_SEARCH',
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input: travelSearchInput,
  output: travelSearchOutput,
  maxOutputChars: 40_000,
  async handler(ctx, i) {
    const s = travelServices(ctx);
    const deps = { db: s.db, now: ctx.now, flights: s.flights, hotels: s.hotels, warn: s.warn };
    const outcome = i.kind === 'flights' ? await searchFlights(deps, i) : await searchHotels(deps, i);
    return ok({ data: outcome, sources: [BRIEF_CITATION], ...(outcome.snapshot ? { retrievedAt: outcome.snapshot.retrievedAt } : {}) });
  },
});
