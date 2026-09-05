import type { Citation } from '@/contracts/provenance';
import type { Db } from '@/db/client';
import type { ReservationVenueRow } from '@/db/schema';
import { getContentSource } from '@/db/repos/site';
import type { ReservationRung, ReservationsProvider } from '@/providers/reservations/types';
import { toGuestHandoff, type GuestHandoff } from '../external/handoff';
import { getReservationVenue, listReservationVenues } from './repo';

export const CONTACT_ROUTE = '/ask-us';

export interface ReservationVenueView {
  id: string;
  name: string;
  note: string | null;
  placeholder: boolean;
  verifiedAt: string | null;
  sourceId: string | null;
}

export interface ReservationOptionView {
  venue: ReservationVenueView;
  /** Which rung of the ladder answered: api -> deep-link -> url -> unavailable (ADR-0004 §3). */
  rung: ReservationRung;
  /** Whether a supported API could commit a reservation from this site (never true until an adapter exists). */
  canCommit: boolean;
  handoff?: GuestHandoff;
  unavailable?: { message: string; contactRoute: typeof CONTACT_ROUTE };
}

export interface ReservationWhen {
  date?: string;
  time?: string;
  partySize?: number;
}

export function venueView(v: ReservationVenueRow): ReservationVenueView {
  return { id: v.id, name: v.name, note: v.note, placeholder: v.placeholder, verifiedAt: v.verifiedAt?.toISOString() ?? null, sourceId: v.sourceId };
}

const UNAVAILABLE_MESSAGE = 'We do not have a reservation link for this place yet. Ask us and we will point you the right way.';

/** Runs the ladder for one venue. Every URL is validated against the allowlist even when the provider built it. */
export async function reservationOptionFor(provider: ReservationsProvider, v: ReservationVenueRow, when: ReservationWhen = {}): Promise<ReservationOptionView> {
  const view = venueView(v);
  const result = await provider.options({ name: v.name, resySlug: v.resySlug ?? undefined, openTableId: v.openTableId ?? undefined, url: v.url ?? undefined }, { date: when.date, partySize: when.partySize });
  if (!result.ok || result.value.rung === 'unavailable' || !result.value.handoff) {
    return { venue: view, rung: 'unavailable', canCommit: false, unavailable: { message: UNAVAILABLE_MESSAGE, contactRoute: CONTACT_ROUTE } };
  }
  const handoff = toGuestHandoff(result.value.handoff);
  if (!handoff.ok) return { venue: view, rung: 'unavailable', canCommit: false, unavailable: { message: UNAVAILABLE_MESSAGE, contactRoute: CONTACT_ROUTE } };
  return { venue: view, rung: result.value.rung, canCommit: result.value.rung === 'api' && provider.capabilities.api === true, handoff: handoff.value };
}

export async function reservationOptions(db: Db, provider: ReservationsProvider, input: { venueId?: string } & ReservationWhen): Promise<{ options: ReservationOptionView[]; sources: Citation[] } | null> {
  const venues = input.venueId ? [await getReservationVenue(db, input.venueId)].filter((v): v is ReservationVenueRow => v !== null) : await listReservationVenues(db);
  if (input.venueId && venues.length === 0) return null;
  const options: ReservationOptionView[] = [];
  for (const v of venues) options.push(await reservationOptionFor(provider, v, input));
  const sources: Citation[] = [];
  const seen = new Set<string>();
  for (const v of venues) {
    if (!v.sourceId || seen.has(v.sourceId)) continue;
    seen.add(v.sourceId);
    const source = await getContentSource(db, v.sourceId);
    if (source) sources.push({ sourceId: source.id as Citation['sourceId'], title: source.title, url: source.canonicalUrl ?? undefined, verifiedAt: source.verifiedAt.toISOString() });
  }
  return { options, sources };
}

/** The confirmation card a guest reviews before any commit. Contact details stay in the card, never in records. */
export interface ReservationCard {
  venue: ReservationVenueView;
  date: string;
  time: string;
  partySize: number;
  contactName: string;
}
