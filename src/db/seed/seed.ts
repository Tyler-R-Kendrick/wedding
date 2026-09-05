import { pathToFileURL } from 'node:url';
import { READINESS_GATED } from '@/contracts/flags';
import { WEDDING_DATE_ISO, WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import type { Db } from '../client';
import { contentSources, featureFlags, lifecycleState, siteSettings } from '../schema';
import { BRIEF_SOURCE_ID, SEED_SITE_ID, SEED_SOURCES } from './sources';

/** Facts from docs/design/brief.md section 2. Anything else is a TODO(Tyler & Sara), never invented. */
export const SEED_SITE = {
  id: SEED_SITE_ID,
  coupleDisplayName: 'Sara + Tyler',
  partner1Name: 'Sara Fitzgerald',
  partner2Name: 'Tyler Kendrick',
  weddingDate: WEDDING_DATE_ISO,
  timezone: WEDDING_TIMEZONE,
  venueName: 'Chicago Athletic Association Hotel',
  venueAddress: '12 S Michigan Ave, Chicago, IL 60603',
  venueUrl: 'https://www.chicagoathletichotel.com/',
  themes: ['gilded-hour', 'conservatory'],
  defaultTheme: 'gilded-hour',
  sourceId: BRIEF_SOURCE_ID,
} as const;

/** Idempotent: safe to run on every boot and in every test. */
export async function seed(db: Db): Promise<void> {
  const now = new Date();

  for (const s of SEED_SOURCES) {
    const values = {
      id: s.id,
      sourceType: s.sourceType,
      title: s.title,
      canonicalUrl: s.canonicalUrl ?? null,
      documentName: s.documentName ?? null,
      verifiedAt: new Date(s.verifiedAt),
      validFrom: s.validFrom ? new Date(s.validFrom) : null,
      validUntil: s.validUntil ? new Date(s.validUntil) : null,
      trustClass: s.trustClass,
      notes: s.notes ?? null,
      updatedAt: now,
    };
    await db
      .insert(contentSources)
      .values(values)
      .onConflictDoUpdate({ target: contentSources.id, set: values });
  }

  const site = { ...SEED_SITE, themes: [...SEED_SITE.themes], updatedAt: now };
  await db.insert(siteSettings).values(site).onConflictDoUpdate({ target: siteSettings.id, set: site });

  await db
    .insert(lifecycleState)
    .values({ id: 'current', state: 'TEASER', publishedAt: now, publishedBy: { kind: 'system', component: 'seed' }, note: 'Initial seed' })
    .onConflictDoNothing();

  for (const flag of READINESS_GATED) {
    await db
      .insert(featureFlags)
      .values({ name: flag, readiness: false, updatedBy: { kind: 'system', component: 'seed' }, updatedAt: now })
      .onConflictDoNothing();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { getDb, resetDb } = await import('../client');
  const db = await getDb();
  await seed(db);
  console.log('seed complete');
  await resetDb();
}
