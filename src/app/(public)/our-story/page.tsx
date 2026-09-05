import type { Metadata } from 'next';
import { invoke } from '@/capabilities/invoke';
import { getStory } from '@/capabilities/get_story';
import { publicPageContext } from '@/domain/content/page-context';
import { recipes } from '../_recipes';

export const metadata: Metadata = { title: 'Our Story' };

export default async function OurStoryPage() {
  const { ctx } = await publicPageContext();
  const r = await invoke(getStory, ctx, {});
  if (!r.ok) throw new Error(r.error.message);
  return <recipes.StoryPage data={r.value.data} />;
}
