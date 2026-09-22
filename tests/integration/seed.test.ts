import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { isInternalRoute } from '@/capabilities/routes';
import { getDb } from '@/db/client';
import { getLifecycle, getSiteSettings, listContentSources } from '@/db/repos/site';
import { events, floorPlans, rsvpSettings, featureFlags, siteSettings } from '@/db/schema';
import { seed, SEED_SITE } from '@/db/seed/seed';
import { SEED_SOURCES } from '@/db/seed/sources';
import { ID_PATTERN } from '@/contracts/ids';
import { freshnessOf, FRESHNESS_POLICIES } from '@/contracts/provenance';

describe('seed', () => {
  it('inserts the site, lifecycle, readiness rows and provenance sources idempotently', async () => {
    const db = await getDb();
    await seed(db); // second run
    const site = await getSiteSettings(db);
    expect(site).toMatchObject({ coupleDisplayName: 'Sara + Tyler', weddingDate: '2027-07-17', timezone: 'America/Chicago', venueName: SEED_SITE.venueName, themes: ['botanical-deco', 'gilded-hour', 'conservatory'], defaultTheme: 'botanical-deco' });
    expect((await getLifecycle(db))?.state).toBe('TEASER');
    const sources = await listContentSources(db);
    expect(sources).toHaveLength(SEED_SOURCES.length);
    for (const s of sources) expect(s.id).toMatch(ID_PATTERN);
    const kit = sources.find((s) => s.title === 'CAA Wedding Kit 2027')!;
    expect(kit.sourceType).toBe('venue-document');
    expect(freshnessOf({ verifiedAt: kit.verifiedAt.toISOString(), validUntil: kit.validUntil?.toISOString() }, FRESHNESS_POLICIES.operational, new Date('2027-01-15T00:00:00Z'))).toBe('expired');
    const flags = await db.select().from(featureFlags);
    expect(flags.map((f) => f.name).sort()).toEqual(['PRO_MEDIA_AI_PROCESSING']);
    expect(flags.every((f) => f.readiness === false)).toBe(true);
    // The brief citation points guests at a public route, not a repository path.
    const brief = sources.find((s) => s.id === SEED_SITE.sourceId)!;
    expect(brief.canonicalUrl).toBe('/the-wedding');
    expect(isInternalRoute(brief.canonicalUrl!)).toBe(true);
    expect(brief.canonicalUrl).not.toMatch(/^\/docs\//);
  });

  it('covers the swarm E tables, which production has no other writer for', async () => {
    // `ensureSwarmESeeded` (src/domain/events/boot.ts) returns early when isProduction and
    // DB_AUTO_SEED is off, which is how production now runs — so if `seed()` does not write these,
    // the runbook's `npm run db:seed` leaves every RSVP and seating read with nothing to find.
    // Mutation: drop the seedEventsAndPlans call from seed().
    const db = await getDb();
    await seed(db);
    expect((await db.select().from(events)).length, 'events').toBeGreaterThan(0);
    expect((await db.select().from(floorPlans)).length, 'floor_plans').toBeGreaterThan(0);
    expect((await db.select().from(rsvpSettings)).length, 'rsvp_settings').toBeGreaterThan(0);
  });

  it('never overwrites admin edits to site_settings on a reseed', async () => {
    const db = await getDb();
    await db.update(siteSettings).set({ coupleDisplayName: 'Edited by an admin' }).where(eq(siteSettings.id, SEED_SITE.id));
    await seed(db);
    expect((await getSiteSettings(db))?.coupleDisplayName).toBe('Edited by an admin');
    await db.update(siteSettings).set({ coupleDisplayName: SEED_SITE.coupleDisplayName }).where(eq(siteSettings.id, SEED_SITE.id));
  });
});
