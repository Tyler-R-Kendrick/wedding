import type { Metadata } from 'next';
import { getMyTransportationOptions } from '@/capabilities/get_my_transportation_options';
import { TransportationPageRecipe } from '@/components/handoff/page-recipes';
import { invokeForPage } from '@/components/handoff/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Transportation', robots: { index: false, follow: false } };

/** Public guidance for everyone; the personal ride benefit only for the signed-in guest it belongs to. Rendered per request, never cached. */
export default async function TransportationPage() {
  const { result } = await invokeForPage(getMyTransportationOptions, {});
  if (!result.ok) {
    return (
      <main id="main" className="mx-auto w-full max-w-[42rem] px-5 py-10">
        <h1 className="text-3xl">Transportation</h1>
        <p className="mt-4 measure">{result.error.message}</p>
      </main>
    );
  }
  return <TransportationPageRecipe data={{ ...result.value.data, signInRoute: '/' }} />;
}
