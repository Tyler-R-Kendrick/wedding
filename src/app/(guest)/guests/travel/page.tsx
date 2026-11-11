import type { Metadata } from 'next';
/*
 * The guest form kit. `(guest)` and `(admin)` import it from their layouts; this is the one public
 * route with a form a guest fills in, and its controls are written against the same `.fld` /
 * `.inp` / `.btn` classes (see `search-form.tsx`), so the route brings them with it rather than
 * pushing the guest kit onto every public page.
 */
import '@/components/rsvp/recipes.css';
import '@/themes/botanical-deco/guest.css';
import { headers } from 'next/headers';
import { getMyTravelProfile, listHotelRecommendations } from '@/capabilities/travel';
import { buildTravelSearchDefaults } from '@/domain/travel/prefill';
import type { TravelProfile } from '@/domain/travel/types';
import { getDb } from '@/db/client';
import { throughSignIn } from '@/domain/lifecycle/account';
import { requireSignedIn } from '@/app/(guest)/guests/_lib/gate';
import { currentPrincipal, runAsUi } from './_shared/server';
import { PATHNAME_HEADER } from '@/themes/routes';
import { recipes } from '@/app/(public)/_recipes';
import { FlightSearchForm, HotelSearchForm } from './search-form';
import { TripPlanner } from '@/components/trip/TripPlanner';
import { stayFacts } from '@/domain/trip-planner';
import { loadPlanner } from './planner-data';
import { removePlannerPlace, savePlannerPlace } from './planner-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your Trip' };

/**
 * Your Trip. Fetches theme-agnostic data through capabilities and renders the page recipe; live
 * flight/hotel searches happen only from the forms (explicit action), never on load. The last
 * section is the planner: the couple's places, the guest's saved weekend (their own trip items),
 * their bookings and the wedding's events, handed to the client as plain props.
 */
export default async function TravelPage() {
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? '/guests/travel';
  const { principal } = await currentPrincipal();
  await requireSignedIn(principal, pathname);
  const hotels = await runAsUi(listHotelRecommendations, {});
  if (!hotels.ok) {
    return (
      <main id="main" className="mx-auto max-w-[46rem] px-4 py-10">
        <h1 className="text-4xl font-semibold">Your Trip</h1>
        <p className="mt-3">{hotels.error.message}</p>
      </main>
    );
  }
  let profile: TravelProfile | null = null;
  let searchDefaults = { flight: {} as Record<string, string>, hotel: {} as Record<string, string>, originSuggestions: [] as { iata: string; name: string; distanceKm: number }[] };
  if (principal.kind === 'guest') {
    const mine = await runAsUi(getMyTravelProfile, {});
    if (mine.ok) profile = mine.value.data.profile;
    searchDefaults = await buildTravelSearchDefaults(await getDb(), principal.guestId, profile);
  }
  const planner = await loadPlanner(principal);
  const flightDefaults = searchDefaults.flight;
  const hotelDefaults = searchDefaults.hotel;
  // Swarm F left this seam open ("at integration this becomes `theme.recipes.travel ?? …`"), and
  // this is that integration: the page goes through the same themed dispatch every other public
  // page uses, so it renders inside the active theme's Shell — nav, footer, tokens and all — and
  // Gilded Hour and Conservatory each express it. Rendering its own <main> outside the Shell is
  // what left this page wearing neither design, and what let its raw Tailwind widths resolve
  // against the DESIGN.md spacing scale.
  return (
    <recipes.TravelPage
      signedIn={principal.kind !== 'anonymous'}
      venue={hotels.value.data.venue}
      alternatives={hotels.value.data.alternatives}
      facts={hotels.value.data.facts}
      sources={hotels.value.sources}
      // Signed out, "Your trip" goes through sign-in and comes back; a direct /trip link was a dead end.
      tripHref={principal.kind === 'guest' ? '/trip' : throughSignIn('/trip')}
      slots={{
        flightSearch: <FlightSearchForm defaults={flightDefaults} originSuggestions={searchDefaults.originSuggestions} />,
        hotelSearch: <HotelSearchForm defaults={hotelDefaults} />,
        planner: (
          <TripPlanner
            places={planner.places}
            saved={planner.saved}
            bookings={planner.bookings}
            events={planner.events}
            hotel={planner.hotel}
            stay={stayFacts(hotels.value.data.venue.block)}
            // A guest's weekend is saved as their trip items; an administrator previewing keeps it in memory.
            actions={planner.persist ? { save: savePlannerPlace, remove: removePlannerPlace } : undefined}
          />
        ),
      }}
    />
  );
}
