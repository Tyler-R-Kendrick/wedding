import type { ExternalHandoff } from '@/contracts/providers';
import { ok } from '@/contracts/result';
import { assertAllowedRedirect } from '@/lib/redirects';
import { okConfig, upHealth } from '../base';
import type { ReservablePlace, ReservationOptions, ReservationsProvider } from './types';

const SLUG = /^[a-z0-9-]{1,80}$/;

export function reservationDeepLink(place: ReservablePlace, when: { date?: string; partySize?: number } = {}): ExternalHandoff | undefined {
  if (place.resySlug && SLUG.test(place.resySlug)) {
    const params = new URLSearchParams();
    if (when.date) params.set('date', when.date);
    if (when.partySize) params.set('seats', String(when.partySize));
    const qs = params.size ? `?${params.toString()}` : '';
    return { provider: 'resy', label: `Reserve on Resy`, url: `https://resy.com/cities/chi/${place.resySlug}${qs}`, opensNewTab: true, disclosure: `You will leave our site to reserve at ${place.name} on Resy.` };
  }
  if (place.openTableId && SLUG.test(place.openTableId)) {
    const params = new URLSearchParams();
    if (when.date) params.set('dateTime', `${when.date}T19:00`);
    if (when.partySize) params.set('covers', String(when.partySize));
    const qs = params.size ? `?${params.toString()}` : '';
    return { provider: 'opentable', label: 'Reserve on OpenTable', url: `https://www.opentable.com/r/${place.openTableId}${qs}`, opensNewTab: true, disclosure: `You will leave our site to reserve at ${place.name} on OpenTable.` };
  }
  return undefined;
}

/** No reservation API is integrated; the ladder starts at deep links. */
export class MockReservations implements ReservationsProvider {
  readonly kind = 'reservations' as const;
  readonly name = 'mock';
  readonly mode = 'deep-link' as const;
  readonly capabilities = { api: false, deepLink: true, url: true };
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  async options(place: ReservablePlace, when: { date?: string; partySize?: number } = {}) {
    const deep = reservationDeepLink(place, when);
    if (deep) return ok<ReservationOptions>({ rung: 'deep-link', handoff: deep });
    if (place.url && assertAllowedRedirect(place.url).ok) {
      return ok<ReservationOptions>({ rung: 'url', handoff: { provider: 'website', label: `Visit ${place.name}`, url: place.url, opensNewTab: true, disclosure: `You will leave our site to ${place.name}'s website.` } });
    }
    return ok<ReservationOptions>({ rung: 'unavailable' });
  }
}
