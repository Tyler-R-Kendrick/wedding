import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { showVenueRoom } from '@/capabilities/show_venue_room';
import { requireSignedIn } from '@/app/(guest)/guests/_lib/gate';
import { publicPageContext } from '@/domain/content/page-context';
import { recipes } from '../../_recipes';

export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  // The room's own name (White City Ballroom), not its slug; an unknown slug 404s below anyway.
  // A signed-out reader gets neither: the capability refuses them, and the title stays generic.
  const { ctx } = await publicPageContext();
  const r = await invoke(showVenueRoom, ctx, { slug });
  return { title: r.ok ? r.value.data.space.name : 'Our Venue', robots: { index: false, follow: false } };
}

export default async function VenueSpaceRoute({ params }: { params: Params }) {
  const { slug } = await params;
  const { ctx, principal } = await publicPageContext();
  await requireSignedIn(principal, `/our-venue/${slug}`);
  const r = await invoke(showVenueRoom, ctx, { slug });
  if (!r.ok) {
    if (r.error.code === 'not_found' || r.error.code === 'validation') notFound();
    throw new Error(r.error.message);
  }
  return <recipes.VenueSpacePage data={r.value.data} />;
}
