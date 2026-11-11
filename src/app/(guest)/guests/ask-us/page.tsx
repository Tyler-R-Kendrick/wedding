import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { invoke } from '@/capabilities/invoke';
import { getFaq } from '@/capabilities/get_faq';
import { searchWeddingInformationStatic } from '@/capabilities/search_wedding_information_static';
import { ConciergeSlot } from '@/components/concierge';
import { GuestsOnly } from '@/components/rsvp/GuestsOnly';
import { publicPageContext } from '@/domain/content/page-context';
import { requireSignedIn } from '@/app/(guest)/guests/_lib/gate';
import { getLifecycleView } from '@/domain/lifecycle';
import { getFlags } from '@/lib/flags';
import { pageForUrl, visibleIn } from '@wedding/sitemap';
import { PATHNAME_HEADER } from '@/themes/routes';
import { recipes } from '@/app/(public)/_recipes';
import { GuestModelKeeper } from '@/components/local-models/GuestModelKeeper';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Ask Us', robots: { index: false, follow: false } };

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AskUsPage({ searchParams }: { searchParams: Params }) {
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? '/guests/ask-us';
  const { ctx, principal } = await publicPageContext();
  await requireSignedIn(principal, pathname, searchParams);
  if (principal.kind === 'admin') return <GuestsOnly admin what="Ask Us" returnTo={pathname} />;

  const q = one((await searchParams).q)?.trim();
  const [faq, search] = await Promise.all([
    invoke(getFaq, ctx, {}),
    q && q.length >= 2 ? invoke(searchWeddingInformationStatic, ctx, { query: q.slice(0, 200) }) : Promise.resolve(undefined),
  ]);
  if (!faq.ok) throw new Error(faq.error.message);
  // An answer may point at the page that holds more ("See Photos & Video"). Only when that page is
  // open at this point in the timeline: a link to the gallery a year before there is one sends a
  // guest to something they cannot use yet, which is exactly what the navigation no longer does.
  const { state } = await getLifecycleView({ principal });
  const openNow = (route: string) => {
    const page = pageForUrl(route.split(/[?#]/)[0]!);
    return !page || visibleIn(page, state);
  };
  const entries = faq.value.data.entries.map((e) => (e.route && !openNow(e.route) ? { ...e, route: undefined } : e));
  // The route decides whether the concierge exists on this page; the recipes only place it. With
  // the flag off the prop is undefined and each design falls back to its own note, so the page is
  // complete either way — the FAQ and the no-JavaScript search form above it are the product.
  const concierge = getFlags().AI_CONCIERGE ? <ConciergeSlot /> : undefined;
  return (
    <>
      <recipes.AskPage faq={{ ...faq.value.data, entries }} search={search && search.ok ? search.value.data : q ? { query: q, results: [] } : undefined} concierge={concierge} />
      <GuestModelKeeper principal={principal} />
    </>
  );
}
