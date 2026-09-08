import type { Metadata } from 'next';
import { invoke } from '@/capabilities';
import { getMyItinerary } from '@/capabilities/rsvp';
import { FriendlyFailure, GuestsOnly } from '@/components/rsvp/GuestsOnly';
import { WeekendPage } from '@/components/weekend/WeekendPage';
import { getRequestTheme } from '@/themes/server';
import { uiContext } from '../_shared/principal';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your Weekend', robots: { index: false, follow: false } };

export default async function YourWeekendPage() {
  const { ctx, principal } = await uiContext();
  if (principal.kind !== 'guest') return <GuestsOnly what="Your Weekend" returnTo="/your-weekend" />;
  const result = await invoke(getMyItinerary, ctx, {});
  if (!result.ok) {
    if (result.error.code === 'unauthenticated' || result.error.code === 'forbidden') return <GuestsOnly what="Your Weekend" signedIn />;
    return <FriendlyFailure what="Your Weekend" />;
  }
  // The recipe renders the ACTIVE DESIGN's sections and cards, so it needs the theme the layout
  // resolved. Same request, same resolution — `getRequestTheme` reads the header the proxy set.
  return <WeekendPage data={result.value.data} theme={await getRequestTheme()} />;
}
