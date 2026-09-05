import type { Metadata } from 'next';
import { noticeFor } from '@/app/(public)/travel/_shared/recipe';
import { currentPrincipal, runAsUi } from '@/app/(public)/travel/_shared/server';
import { getMyTravelProfile, getMyTrip } from '@/capabilities/travel';
import { AddItemForm, ProfileForm } from './forms';
import { TripGate, TripPageRecipe, type TripPageData } from './recipe';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your trip', robots: { index: false, follow: false } };

/** Guest-only. Personalised: rendered per request, never cached across identities. */
export default async function TripPage({ searchParams }: { searchParams: Promise<{ ref?: string; outcome?: string; notice?: string }> }) {
  const sp = await searchParams;
  const { principal } = await currentPrincipal();
  if (principal.kind !== 'guest') return <TripGate reason={principal.kind === 'anonymous' ? 'anonymous' : 'forbidden'} />;
  const [trip, profile] = await Promise.all([runAsUi(getMyTrip, {}), runAsUi(getMyTravelProfile, {})]);
  if (!trip.ok) return <TripGate reason="forbidden" />;
  const returned = sp.ref && trip.value.data.items.some((i) => i.id === sp.ref) ? { itemId: sp.ref, outcome: sp.outcome ?? 'success' } : null;
  const data: TripPageData = {
    trip: trip.value.data,
    profile: profile.ok ? profile.value.data.profile : null,
    suggestion: profile.ok ? profile.value.data.suggestion : null,
    returned,
    notice: noticeFor(sp.notice),
  };
  const Recipe = TripPageRecipe; // theme kit seam: theme.recipes.trip ?? TripPageRecipe
  return <Recipe data={data} slots={{ profileForm: <ProfileForm profile={data.profile} suggestion={data.suggestion} />, addItemForm: <AddItemForm /> }} />;
}
