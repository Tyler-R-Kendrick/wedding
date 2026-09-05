import type { Metadata } from 'next';
import { invoke } from '@/capabilities/invoke';
import { findAdventures } from '@/capabilities/find_adventures';
import { listItineraries } from '@/capabilities/list_itineraries';
import { ITINERARY_BUCKETS, type ItineraryBucket } from '@/db/schema/content';
import { publicPageContext } from '@/domain/content/page-context';
import { recipes } from '../_recipes';

export const metadata: Metadata = { title: 'Share an Adventure' };

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ShareAnAdventurePage({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const bucketRaw = one(sp.bucket);
  const bucket = (ITINERARY_BUCKETS as readonly string[]).includes(bucketRaw ?? '') ? (bucketRaw as ItineraryBucket) : undefined;
  const minutes = Number(one(sp.minutes));
  const wantsPlan = Number.isInteger(minutes) && minutes >= 15 && minutes <= 720;
  const kids = one(sp.kids) === '1';
  const interestRaw = one(sp.interest);
  const interest = interestRaw && /^[a-z0-9-]{1,40}$/.test(interestRaw) ? interestRaw : undefined;

  const { ctx } = await publicPageContext();
  const [itineraries, all, plan] = await Promise.all([
    invoke(listItineraries, ctx, bucket ? { bucket } : {}),
    invoke(findAdventures, ctx, {}),
    wantsPlan ? invoke(findAdventures, ctx, { maxMinutes: minutes, kids, ...(interest ? { interests: [interest] } : {}) }) : Promise.resolve(undefined),
  ]);
  if (!itineraries.ok) throw new Error(itineraries.error.message);
  if (!all.ok) throw new Error(all.error.message);
  return (
    <recipes.GuidePage
      itineraries={itineraries.value.data}
      recommendations={all.value.data}
      activeBucket={bucket}
      plan={plan && plan.ok ? { minutes, kids, interest, result: plan.value.data.plan } : undefined}
    />
  );
}
