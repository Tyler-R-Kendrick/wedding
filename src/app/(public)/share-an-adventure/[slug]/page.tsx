import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { invoke } from '@/capabilities/invoke';
import { findAdventures } from '@/capabilities/find_adventures';
import { publicPageContext } from '@/domain/content/page-context';
import { recipes } from '../../_recipes';

type Params = Promise<{ slug: string }>;

/**
 * One lookup per request, shared by the page and its metadata. The tab title used to be the raw URL
 * slug ("starved rock state park"), and whatever someone typed after the slash for an unknown one.
 */
const load = cache(async (slug: string) => {
  const { ctx } = await publicPageContext();
  return invoke(findAdventures, ctx, { slug });
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const r = await load(slug);
  const title = r.ok ? r.value.data.items[0]?.title : undefined;
  return { title: title ?? 'Not found' };
}

export default async function RecommendationDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const r = await load(slug);
  if (!r.ok) {
    if (r.error.code === 'not_found' || r.error.code === 'validation') notFound();
    throw new Error(r.error.message);
  }
  const card = r.value.data.items[0];
  if (!card) notFound();
  return <recipes.RecommendationPage card={card} />;
}
