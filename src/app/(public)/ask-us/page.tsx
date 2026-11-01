import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { getFaq } from '@/capabilities/get_faq';
import { searchWeddingInformationStatic } from '@/capabilities/search_wedding_information_static';
import { ConciergeSlot } from '@/components/concierge';
import { GuestsOnly } from '@/components/rsvp/GuestsOnly';
import { publicPageContext } from '@/domain/content/page-context';
import { enforceGuestPortalRoute } from '@/app/(guest)/guests/_lib/gate';
import { throughSignIn } from '@/domain/lifecycle/account';
import { getFlags } from '@/lib/flags';
import { PATHNAME_HEADER } from '@/themes/routes';
import { recipes } from '../_recipes';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Ask Us', robots: { index: false, follow: false } };

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AskUsPage({ searchParams }: { searchParams: Params }) {
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? '/ask-us';
  const { ctx, principal } = await publicPageContext();
  await enforceGuestPortalRoute(principal, pathname, searchParams, {
    signedIn: principal.kind === 'guest' || principal.kind === 'admin',
    admin: principal.kind === 'admin',
  });
  if (principal.kind === 'anonymous') redirect(throughSignIn(pathname));
  if (principal.kind === 'admin') return <GuestsOnly admin what="Ask Us" returnTo={pathname} />;

  const q = one((await searchParams).q)?.trim();
  const [faq, search] = await Promise.all([
    invoke(getFaq, ctx, {}),
    q && q.length >= 2 ? invoke(searchWeddingInformationStatic, ctx, { query: q.slice(0, 200) }) : Promise.resolve(undefined),
  ]);
  if (!faq.ok) throw new Error(faq.error.message);
  // The route decides whether the concierge exists on this page; the recipes only place it. With
  // the flag off the prop is undefined and each design falls back to its own note, so the page is
  // complete either way — the FAQ and the no-JavaScript search form above it are the product.
  const concierge = getFlags().AI_CONCIERGE ? <ConciergeSlot /> : undefined;
  return <recipes.AskPage faq={faq.value.data} search={search && search.ok ? search.value.data : q ? { query: q, results: [] } : undefined} concierge={concierge} />;
}
