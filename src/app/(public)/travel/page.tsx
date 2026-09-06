import type { Metadata } from 'next';
import { getMyTravelProfile, listHotelRecommendations } from '@/capabilities/travel';
import { currentPrincipal, runAsUi } from './_shared/server';
import { recipes } from '../_recipes';
import { FlightSearchForm, HotelSearchForm } from './search-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Travel & Stay' };

/**
 * Travel & Stay. Fetches theme-agnostic data through capabilities and renders the page recipe;
 * live flight/hotel searches happen only from the forms (explicit action), never on load.
 */
export default async function TravelPage() {
  const { principal } = await currentPrincipal();
  const hotels = await runAsUi(listHotelRecommendations, {});
  if (!hotels.ok) {
    return (
      <main id="main" className="mx-auto max-w-[46rem] px-4 py-10">
        <h1 className="text-4xl font-semibold">Travel &amp; Stay</h1>
        <p className="mt-3">{hotels.error.message}</p>
      </main>
    );
  }
  let profile: Awaited<ReturnType<typeof getMyTravelProfile.handler>> extends never ? never : { preferredAirport: string | null; adults: number; children: number; cabin: string; nonstopPreferred: boolean; arriveEarliest: string | null; departLatest: string | null } | null = null;
  if (principal.kind === 'guest') {
    const mine = await runAsUi(getMyTravelProfile, {});
    if (mine.ok) profile = mine.value.data.profile;
  }
  const flightDefaults = profile
    ? {
        origin: profile.preferredAirport ?? '',
        adults: String(profile.adults),
        children: String(profile.children),
        cabin: profile.cabin,
        nonstopOnly: profile.nonstopPreferred ? 'on' : '',
        departDate: profile.arriveEarliest ?? '',
        returnDate: profile.departLatest ?? '',
      }
    : {};
  // Swarm F left this seam open ("at integration this becomes `theme.recipes.travel ?? …`"), and
  // this is that integration: the page goes through the same themed dispatch every other public
  // page uses, so it renders inside the active theme's Shell — nav, footer, tokens and all — and
  // Gilded Hour and Conservatory each express it. Rendering its own <main> outside the Shell is
  // what left this page wearing neither design, and what let its raw Tailwind widths resolve
  // against the DESIGN.md spacing scale.
  return (
    <recipes.TravelPage
      venue={hotels.value.data.venue}
      alternatives={hotels.value.data.alternatives}
      facts={hotels.value.data.facts}
      sources={hotels.value.sources}
      tripHref="/trip"
      slots={{ flightSearch: <FlightSearchForm defaults={flightDefaults} />, hotelSearch: <HotelSearchForm defaults={{ adults: String(profile?.adults ?? 2) }} /> }}
    />
  );
}
