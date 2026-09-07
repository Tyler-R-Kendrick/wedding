import type { Metadata } from 'next';
import { listGiftLinksCapability } from '@/capabilities/list_gift_links';
import { recipes } from '../_recipes';
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
  // Swarm G left the same seam comment swarm F did ("the theme engine supplies themed recipes with
  // the same PageData props and replaces these plain server components at integration"). This is
  // that integration: /gifts now renders inside the active design's Shell, with nav and footer,
  // instead of its own bare <main>.
  return <recipes.GiftsPage data={result.value.data} />;
}
