import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireSignedIn } from '@/app/(guest)/guests/_lib/gate';
import { getMyTransportationOptions } from '@/capabilities/get_my_transportation_options';
import { TransportationPageRecipe } from '@/components/handoff/page-recipes';
import { invokeForPage, pagePrincipal } from '@/components/handoff/server';
import { GUEST_PATHS } from '@/domain/lifecycle/guest-actions';
import { getRequestTheme } from '@/themes/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Your ride', robots: { index: false, follow: false } };

/**
 * A guest's own ride benefit, and how to claim it. Nothing else: getting to Chicago and around it
 * is on Travel & Stay, said once.
 *
 * So this page exists only for a guest who has a benefit on their invitation. Anyone else who
 * arrives here (an old link, a typed address) is taken to the part of Travel & Stay that answers
 * what they came for, rather than shown a page that says there is nothing on it.
 */
export default async function TransportationPage() {
  const { principal } = await pagePrincipal();
  await requireSignedIn(principal, GUEST_PATHS.ride);
  const { result } = await invokeForPage(getMyTransportationOptions, {});
  if (!result.ok) {
    return (
      <div className="page">
        <h1 className="page__title">Your ride</h1>
        <p className="measure">{result.error.message}</p>
      </div>
    );
  }
  if (result.value.data.benefits.length === 0) redirect(GUEST_PATHS.around);
  // The recipe renders the active design's own sections and cards; the theme comes from the same
  // resolution the layout's Shell used.
  return <TransportationPageRecipe data={{ ...result.value.data, signInRoute: GUEST_PATHS.ride }} theme={await getRequestTheme()} />;
}
