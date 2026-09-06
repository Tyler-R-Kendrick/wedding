import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { idempotencyKeys, jobs, metrics, rateLimits } from '@/db/schema';
import { enqueueHousekeeping, getJobHandler, HOUSEKEEPING_JOB_TYPE, purgeHousekeeping, registerHousekeeping, runDueJobs } from '@/lib/jobs';

describe('housekeeping.purge', () => {
  it('deletes expired idempotency rows, idle rate-limit buckets, and old metrics, keeping live ones', async () => {
    const db = await getDb();
    const now = new Date('2026-09-05T12:00:00Z');
    const day = 86_400_000;
    await db.insert(idempotencyKeys).values([
      { scope: 'hk', key: 'expired', payloadHash: 'h', response: {}, createdAt: new Date(now.getTime() - 2 * day), expiresAt: new Date(now.getTime() - day) },
      { scope: 'hk', key: 'live', payloadHash: 'h', response: {}, createdAt: now, expiresAt: new Date(now.getTime() + day) },
    ]);
    await db.insert(rateLimits).values([
      { key: 'hk:idle', tokens: 5, updatedAt: new Date(now.getTime() - 2 * day) },
      { key: 'hk:hot', tokens: 1, updatedAt: new Date(now.getTime() - 60_000) },
    ]);
    await db.insert(metrics).values([
      { name: 'hk.old', kind: 'counter', value: 1, at: new Date(now.getTime() - 40 * day) },
      { name: 'hk.recent', kind: 'counter', value: 1, at: new Date(now.getTime() - 2 * day) },
    ]);
    expect(await purgeHousekeeping(db, { now })).toEqual({ idempotencyKeys: 1, rateLimits: 1, metrics: 1 });
    expect((await db.select().from(idempotencyKeys)).map((r) => r.key)).toEqual(['live']);
    expect((await db.select().from(rateLimits)).map((r) => r.key)).toEqual(['hk:hot']);
    expect((await db.select().from(metrics)).map((r) => r.name)).toEqual(['hk.recent']);
    expect(await purgeHousekeeping(db, { now })).toEqual({ idempotencyKeys: 0, rateLimits: 0, metrics: 0 });
  });

  it('is registered as a job handler and enqueued at most once per hour by the cron path', async () => {
    const db = await getDb();
    await db.delete(jobs);
    registerHousekeeping();
    expect(getJobHandler(HOUSEKEEPING_JOB_TYPE)).toBeDefined();
    let now = new Date('2026-09-06T12:00:00Z');
    const first = await enqueueHousekeeping(db, { now });
    expect(first?.type).toBe(HOUSEKEEPING_JOB_TYPE);
    expect(await enqueueHousekeeping(db, { now })).toBeNull(); // already queued
    await db.insert(metrics).values({ name: 'hk.ancient', kind: 'counter', value: 1, at: new Date('2020-01-01T00:00:00Z') });
    const summary = await runDueJobs(db, { worker: 'hk', now: () => now });
    expect(summary).toMatchObject({ claimed: 1, succeeded: 1, dead: 0 });
    expect(await db.select().from(metrics).then((r) => r.filter((m) => m.name === 'hk.ancient'))).toHaveLength(0);
    expect(await enqueueHousekeeping(db, { now: new Date(now.getTime() + 30 * 60_000) })).toBeNull(); // ran recently
    now = new Date(now.getTime() + 61 * 60_000);
    expect((await enqueueHousekeeping(db, { now }))?.status).toBe('queued');
  });
});
