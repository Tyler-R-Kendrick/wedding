import type { Metadata } from 'next';
import { invoke } from '@/capabilities/invoke';
import { getVenueFacts } from '@/capabilities/get_venue_facts';
import { requireSignedIn } from '@/app/(guest)/guests/_lib/gate';
import { publicPageContext } from '@/domain/content/page-context';
import { recipes } from '../_recipes';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Our Venue', robots: { index: false, follow: false } };

/** Where the wedding is: for invited guests. A signed-out reader signs in first and comes back. */
export default async function OurVenueRoute() {
  const { ctx, principal } = await publicPageContext();
  await requireSignedIn(principal, '/our-venue');
  // includeExpired is honoured only for content admins; guests never see closed outlets.
  const r = await invoke(getVenueFacts, ctx, { includeExpired: true });
  if (!r.ok) throw new Error(r.error.message);
  return <recipes.OurVenuePage data={r.value.data} />;
}
