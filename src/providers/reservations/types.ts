import type { ExternalHandoff, ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export interface ReservablePlace {
  name: string;
  /** Resy venue slug, e.g. "cindys-rooftop" (resy.com/cities/chi/<slug>). */
  resySlug?: string;
  /** OpenTable restaurant id (opentable.com/r/<id>). */
  openTableId?: string;
  /** Admin-configured booking URL (must pass the redirect allowlist). */
  url?: string;
}

export type ReservationRung = 'api' | 'deep-link' | 'url' | 'unavailable';

export interface ReservationOptions {
  rung: ReservationRung;
  handoff?: ExternalHandoff;
}

/** Capability ladder: API (availability) -> provider deep link -> admin URL -> honest unavailable. */
export interface ReservationsProvider extends ProviderDescriptor {
  kind: 'reservations';
  options(place: ReservablePlace, when?: { date?: string; partySize?: number }): Promise<Result<ReservationOptions, ProviderFailure>>;
}
