import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { getStory } from '@/capabilities/content';
import { getDb } from '@/db/client';

/**
 * A preview deployment reads the production database and never migrates it
 * (scripts/deploy/migrate-on-deploy.mjs). The first preview of the branch that added
 * `timeline_moments` answered 500 on /our-story because the table was not there yet.
 * Until it is, Our Story serves the stations `db:seed` would write; anything else still throws.
 */
describe('Our Story before timeline_moments is migrated', () => {
  it('serves the bundled seed stations instead of failing', async () => {
    const db = await getDb();
    await db.execute(sql`DROP TABLE timeline_moments`);
    const r = await invoke(getStory, await createCapabilityContext({ principal: { kind: 'anonymous' }, requestId: 'req-unmigrated', surface: 'ui' }), {});
    expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.sections).toHaveLength(7);
    expect(r.value.data.timeline.map((m) => m.slug)).toContain('starved-rock');
    expect(r.value.data.timeline.map((m) => m.slug)[0]).toBe('allison-and-jamies-wedding');
  });
});
