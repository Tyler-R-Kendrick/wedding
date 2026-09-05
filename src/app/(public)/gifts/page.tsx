import type { Metadata } from 'next';
import { listGiftLinksCapability } from '@/capabilities/list_gift_links';
import { GiftsPageRecipe } from '@/components/handoff/page-recipes';
import { invokeForPage } from '@/components/handoff/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Gifts' };

/** "Help us with our next adventures": explicit provider handoffs, never a checkout. */
export default async function GiftsPage() {
  const { result } = await invokeForPage(listGiftLinksCapability, {});
  if (!result.ok) {
    return (
      <main id="main" className="mx-auto w-full max-w-[42rem] px-5 py-10">
        <h1 className="text-3xl">Gifts</h1>
        <p className="mt-4 max-w-[65ch]">{result.error.message}</p>
      </main>
    );
  }
  return <GiftsPageRecipe data={result.value.data} />;
}
