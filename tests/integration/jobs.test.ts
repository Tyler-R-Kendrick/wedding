import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { jobs } from '@/db/schema';
import { clearJobHandlers, JobQueue, registerJobHandler, runDueJobs } from '@/lib/jobs';

describe('job queue', () => {
  beforeEach(async () => {
    clearJobHandlers();
    await (await getDb()).delete(jobs);
  });

  it('enqueues, claims, completes, and de-duplicates', async () => {
    const db = await getDb();
    let now = new Date('2026-09-05T12:00:00Z');
    const q = new JobQueue(db, () => now);
    const a = await q.enqueue({ type: 'media.caption', payload: { id: 1 }, dedupeKey: 'caption:1' });
    const dup = await q.enqueue({ type: 'media.caption', payload: { id: 1 }, dedupeKey: 'caption:1' });
    expect(dup.id).toBe(a.id);
    const later = await q.enqueue({ type: 'media.caption', payload: { id: 2 }, runAt: new Date('2026-09-05T13:00:00Z') });
    const claimed = await q.claim('w1', 10);
    expect(claimed.map((j) => j.id)).toEqual([a.id]);
    expect(claimed[0]?.attempts).toBe(1);
    expect(await q.claim('w2', 10)).toEqual([]);
    await q.complete(a.id);
    expect((await q.get(a.id))?.status).toBe('succeeded');
    now = new Date('2026-09-05T13:00:01Z');
    expect((await q.claim('w1', 10)).map((j) => j.id)).toEqual([later.id]);
    const reissued = await q.enqueue({ type: 'media.caption', payload: { id: 1 }, dedupeKey: 'caption:1' });
    expect(reissued.id).not.toBe(a.id);
  });

  it('retries with backoff and dies after maxAttempts', async () => {
    const db = await getDb();
    let now = new Date('2026-09-06T12:00:00Z');
    const q = new JobQueue(db, () => now);
    const job = await q.enqueue({ type: 'flaky', maxAttempts: 2 });
    const [first] = await q.claim('w', 1);
    expect(first?.id).toBe(job.id);
    expect(await q.fail(job.id, new Error('boom'))).toBe('retry');
    const afterFail = (await q.get(job.id))!;
    expect(afterFail.status).toBe('queued');
    expect(afterFail.runAt.getTime()).toBeGreaterThan(now.getTime());
    expect(afterFail.lastError).toBe('boom');
    expect(await q.claim('w', 1)).toEqual([]);
    now = new Date(afterFail.runAt.getTime() + 1);
    const [second] = await q.claim('w', 1);
    expect(second?.attempts).toBe(2);
    expect(await q.fail(job.id, 'still broken')).toBe('dead');
    expect((await q.get(job.id))?.status).toBe('dead');
  });

  it('reaps stale locks and runs handlers through the runner', async () => {
    const db = await getDb();
    let now = new Date('2026-09-07T12:00:00Z');
    const q = new JobQueue(db, () => now);
    const stuck = await q.enqueue({ type: 'stuck' });
    await q.claim('dead-worker', 1);
    now = new Date('2026-09-07T13:00:00Z');
    expect(await q.reapStale(60_000)).toBe(1);
    expect((await q.get(stuck.id))?.status).toBe('queued');

    const seen: unknown[] = [];
    registerJobHandler('stuck', async (payload, job, ctx) => {
      seen.push({ payload, id: job.id, principal: ctx.principal.kind });
    });
    const summary = await runDueJobs(db, { worker: 'runner', now: () => now });
    expect(summary).toMatchObject({ claimed: 1, succeeded: 1, dead: 0 });
    expect(seen).toEqual([{ payload: {}, id: stuck.id, principal: 'system' }]);
    expect((await q.get(stuck.id))?.status).toBe('succeeded');

    await q.enqueue({ type: 'no.handler', maxAttempts: 1 });
    const s2 = await runDueJobs(db, { worker: 'runner', now: () => now });
    expect(s2).toMatchObject({ claimed: 1, succeeded: 0, dead: 1 });
    expect(Object.keys(await q.countByStatus()).sort()).toEqual(expect.arrayContaining(['dead', 'succeeded']));
  });
});
