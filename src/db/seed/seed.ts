import { pathToFileURL } from 'node:url';
import { READINESS_GATED } from '@/contracts/flags';
import { seedEventsAndPlans } from '@/domain/events/seed';
import type { Db } from '../client';
import { contentSources, featureFlags, lifecycleState, siteSettings } from '../schema';
import { seedContent } from './content';
import { seedTravelHotels } from './travel';
import { SEED_SITE } from './site';
import { SEED_SOURCES } from './sources';

export { SEED_SITE } from './site';

/** The provenance rows every seeded record cites. Code-owned: always refreshed from SEED_SOURCES. */
export async function seedSources(db: Db, now: Date = new Date()): Promise<void> {
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
}

/** Idempotent: safe to run on every boot and in every test. */
export async function seed(db: Db): Promise<void> {
  const now = new Date();

  await seedSources(db, now);

  // Seeded once; afterwards the site row belongs to the admins (a reseed must never revert their edits).
  const site = { ...SEED_SITE, themes: [...SEED_SITE.themes], updatedAt: now };
  await db.insert(siteSettings).values(site).onConflictDoNothing();

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

  // Events, the rsvp_settings 'current' row and the placeholder floor plans (swarm E). Requested
  // by src/domain/events/boot.ts: until this call existed, the only writer of these tables was a
  // lazy per-handler boot that returns early in production, so `npm run db:seed` — the runbook's
  // production step — left them empty and every RSVP and seating read had nothing to find.
  await seedEventsAndPlans(db, now);

  const { seedPreviewPersonas } = await import('@/domain/identity/preview-personas');
  await seedPreviewPersonas(db, now);

  // Story, adventures, recommendations, venue docent, operational fields, FAQ, and the AI corpus (swarm C).
  await seedContent(db, now);

  // Venue room block (Tyler decision T1): signed-in guests only at read time.
  await seedTravelHotels(db, now);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // Not a bare top-level await, for the reason given in migrate.ts and one more: opening the
  // database can itself seed (dev defaults), which imports this module, and a module that is still
  // awaiting at its top level never finishes loading for whoever imports it. `npm run db:seed`
  // exited 13 with "unsettled top-level await" and seeded nothing.
  void (async () => {
    try {
      const { getDb, resetDb } = await import('../client');
      const db = await getDb();
      await seed(db);
      console.log('seed complete');
      await resetDb();
    } catch (error) {
      console.error('seed failed:', error);
      process.exitCode = 1;
    }
  })();
}
