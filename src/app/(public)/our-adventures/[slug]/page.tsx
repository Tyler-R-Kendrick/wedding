import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { invoke } from '@/capabilities/invoke';
import { showAdventure } from '@/capabilities/show_adventure';
import { publicPageContext } from '@/domain/content/page-context';
import { recipes } from '../../_recipes';

type Params = Promise<{ slug: string }>;

/**
 * One lookup per request, shared by the page and its metadata. The tab title used to be the raw URL
 * slug ("starved rock state park"), and whatever someone typed after the slash for an unknown one.
 */
const load = cache(async (slug: string) => {
  const { ctx } = await publicPageContext();
  return invoke(showAdventure, ctx, { slug });
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const r = await load(slug);
  const title = r.ok ? r.value.data.title : undefined;
  if (title) return { title };
  // "Not found" only when it is: a failed read (a rate limit, the database) keeps the site's default title.
  return r.ok || r.error.code === 'not_found' || r.error.code === 'validation' ? { title: 'Not found' } : {};
}

export default async function AdventurePage({ params }: { params: Params }) {
  const { slug } = await params;
  const r = await load(slug);
  if (!r.ok) {
    if (r.error.code === 'not_found' || r.error.code === 'validation') notFound();
    throw new Error(r.error.message);
  }
  return <recipes.AdventureDetailPage data={r.value.data} />;
}
