import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { findAdventures } from '@/capabilities/find_adventures';
import { publicPageContext } from '@/domain/content/page-context';
import { recipes } from '../../_recipes';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug.replace(/-/g, ' ') };
}

export default async function RecommendationDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const { ctx } = await publicPageContext();
  const r = await invoke(findAdventures, ctx, { slug });
  if (!r.ok) {
    if (r.error.code === 'not_found' || r.error.code === 'validation') notFound();
    throw new Error(r.error.message);
  }
  const card = r.value.data.items[0];
  if (!card) notFound();
  return <recipes.RecommendationPage card={card} />;
}
