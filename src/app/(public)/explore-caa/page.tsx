import type { Metadata } from 'next';
import { invoke } from '@/capabilities/invoke';
import { getVenueFacts } from '@/capabilities/get_venue_facts';
import { publicPageContext } from '@/domain/content/page-context';
import { recipes } from '../_recipes';

export const metadata: Metadata = { title: 'Explore CAA' };

export default async function ExploreCaaRoute() {
  const { ctx } = await publicPageContext();
  // includeExpired is honoured only for content admins; guests never see closed outlets.
  const r = await invoke(getVenueFacts, ctx, { includeExpired: true });
  if (!r.ok) throw new Error(r.error.message);
  return <recipes.ExploreCaaPage data={r.value.data} />;
}
