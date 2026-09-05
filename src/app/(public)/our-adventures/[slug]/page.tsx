import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { showAdventure } from '@/capabilities/show_adventure';
import { publicPageContext } from '@/domain/content/page-context';
import { recipes } from '../../_recipes';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug.replace(/-/g, ' ') };
}

export default async function AdventurePage({ params }: { params: Params }) {
  const { slug } = await params;
  const { ctx } = await publicPageContext();
  const r = await invoke(showAdventure, ctx, { slug });
  if (!r.ok) {
    if (r.error.code === 'not_found' || r.error.code === 'validation') notFound();
    throw new Error(r.error.message);
  }
  return <recipes.AdventureDetailPage data={r.value.data} />;
}
