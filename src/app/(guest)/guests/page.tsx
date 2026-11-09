import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { invoke } from '@/capabilities';
import { getMyHousehold } from '@/capabilities/get_my_household';
import { getMyTransportationOptions } from '@/capabilities/get_my_transportation_options';
import { getMyItinerary } from '@/capabilities/rsvp';
import { listHotelRecommendations } from '@/capabilities/travel';
import { FriendlyFailure, GuestsOnly } from '@/components/rsvp/GuestsOnly';
import { Dashboard, type DashboardData } from '@/components/weekend/Dashboard';
import '@/components/weekend/dashboard.css';
import { getCountdown, getLifecycleView, getSiteFacts, nowInLifecycle } from '@/domain/lifecycle';
import { dashboardFacts, type DashboardInput } from '@/domain/weekend';
import { planDashboard } from '@/domain/lifecycle/guest-actions';
import { PREVIEW_HEADER } from '@/themes/routes';
import { uiContext } from '../_shared/principal';
import { requireSignedIn } from './_lib/gate';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your dashboard', robots: { index: false, follow: false } };

/**
 * The signed-in landing. Reads what is true for this guest today — their reply and events, the room
 * block, a ride benefit if there is one — and hands it to the plan for the current point in the
 * timeline (`planDashboard`), which decides what leads.
 *
 * The reply and the events come from the invitation. A guest whose invitation has not been issued
 * yet (everyone, while the save-the-dates are out) has none, and that is not a failure: the
 * dashboard still opens, with the trip to plan, and the RSVP takes its place when it exists.
 */
export default async function GuestPortalPage() {
  const { ctx, principal } = await uiContext();
  await requireSignedIn(principal, '/guests');
  if (principal.kind !== 'guest') return <GuestsOnly admin={principal.kind === 'admin'} what="The guest dashboard" returnTo="/guests" />;

  const preview = (await headers()).get(PREVIEW_HEADER);
  const [itinerary, hotels, rides, household, lifecycle, site, countdown] = await Promise.all([
    invoke(getMyItinerary, ctx, {}),
    invoke(listHotelRecommendations, ctx, {}),
    invoke(getMyTransportationOptions, ctx, {}),
    invoke(getMyHousehold, ctx, {}),
    getLifecycleView({ principal, ...(preview ? { preview: { value: preview, source: 'query' as const } } : {}) }),
    getSiteFacts(),
    getCountdown(),
  ]);
  // No reply or events on this invitation yet is a state, not an error; anything else is.
  if (!itinerary.ok && itinerary.error.code !== 'forbidden' && itinerary.error.code !== 'unauthenticated') return <FriendlyFailure what="Your dashboard" />;
  if (!hotels.ok) return <FriendlyFailure what="Your dashboard" />;

  const mine = itinerary.ok ? itinerary.value.data : null;
  const block = hotels.value.data.venue.block ?? null;
  const input: DashboardInput = {
    state: lifecycle.state,
    itinerary: mine,
    block,
    rideBenefits: rides.ok ? rides.value.data.benefits.length : 0,
    now: nowInLifecycle(),
  };
  const facts = dashboardFacts(input);
  const you = household.ok ? household.value.data.members.find((m) => m.isYou)?.displayName.split(/\s+/)[0] : undefined;
  const data: DashboardData = {
    firstName: mine?.greeting.firstName ?? you ?? null,
    state: lifecycle.state,
    plan: planDashboard(lifecycle.state, facts),
    when: site.date.long,
    where: { name: site.venue.name, city: site.venue.city },
    daysToGo: countdown.isToday || countdown.isPast ? null : countdown.days,
    itinerary: mine,
    hotel: { name: hotels.value.data.venue.name, block },
    blockOpen: facts.blockOpen,
  };
  return <Dashboard data={data} />;
}
