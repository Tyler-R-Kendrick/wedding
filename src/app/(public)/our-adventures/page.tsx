import type { Metadata } from 'next';
import { invoke } from '@/capabilities/invoke';
import { listAdventures } from '@/capabilities/list_adventures';
import { SEASONS, type Season } from '@/db/schema/content';
import { publicPageContext } from '@/domain/content/page-context';
import { recipes } from '../_recipes';

export const metadata: Metadata = { title: 'Our Adventures' };

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function OurAdventuresPage({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const tag = one(sp.tag);
  const seasonRaw = one(sp.season);
  const season = (SEASONS as readonly string[]).includes(seasonRaw ?? '') ? (seasonRaw as Season) : undefined;
  const { ctx } = await publicPageContext();
  const r = await invoke(listAdventures, ctx, { ...(tag && /^[a-z0-9-]{1,40}$/.test(tag) ? { tag } : {}), ...(season ? { season } : {}) });
  if (!r.ok) throw new Error(r.error.message);
  return <recipes.AdventuresPage data={r.value.data} active={{ tag, season }} />;
}
