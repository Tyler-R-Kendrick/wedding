import type { Metadata } from 'next';
import { SEASONS, type Season } from '@/db/schema/content';
import { AdventuresView } from '../_views';

export const metadata: Metadata = { title: 'Our Adventures' };

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** For a reader with a session, or a filtered list; anyone else is served the prerendered copy (src/themes/routes.ts). */
export default async function OurAdventuresPage({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const seasonRaw = one(sp.season);
  const season = (SEASONS as readonly string[]).includes(seasonRaw ?? '') ? (seasonRaw as Season) : undefined;
  return <AdventuresView reader="request" tag={one(sp.tag)} season={season} />;
}
