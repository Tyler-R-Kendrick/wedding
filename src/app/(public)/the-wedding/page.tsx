import type { Metadata } from 'next';
import { publicPageContext } from '@/domain/content/page-context';
import { getWeddingPageData } from '@/domain/venue/wedding-page';
import { recipes } from '../_recipes';

export const metadata: Metadata = { title: 'The Wedding' };

export default async function TheWeddingPage() {
  const { ctx } = await publicPageContext();
  const data = await getWeddingPageData(ctx);
  if (!data) throw new Error('The site has not been set up yet.');
  return <recipes.WeddingPage data={data} />;
}
