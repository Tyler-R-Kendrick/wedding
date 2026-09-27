import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_PURGE_JOB_TYPE } from '@/ai/session';
import { getDb } from '@/db/client';
import { MEDIA_DERIVE_JOB, MEDIA_PROCESS_JOB, MEDIA_SWEEP_JOB } from '@/domain/media/uploads';
import { MEDIA_CLUSTER_JOB, MEDIA_INDEX_JOB } from '@/domain/mediaai/jobs';
import { RSVP_CONFIRMATION_JOB } from '@/domain/rsvp/email';
import { getJobHandler, HOUSEKEEPING_JOB_TYPE, JobQueue, listJobTypes, registerJobHandler, runDueJobs } from '@/lib/jobs';
import { registerAllJobHandlers } from '@/lib/jobs/register-all';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

describe('register-all', () => {
  it('registers every handler the app defines, including the two no runner used to load', () => {
    const types = registerAllJobHandlers();
    for (const type of [
      RSVP_CONFIRMATION_JOB,
      AI_PURGE_JOB_TYPE,
      HOUSEKEEPING_JOB_TYPE,
      MEDIA_PROCESS_JOB,
      MEDIA_DERIVE_JOB,
      MEDIA_SWEEP_JOB,
      MEDIA_INDEX_JOB,
      MEDIA_CLUSTER_JOB,
    ]) {
      expect(types, type).toContain(type);
      expect(getJobHandler(type), type).toBeDefined();
    }
    expect(listJobTypes()).toEqual(types);
  });

  it('imports every module in src/ that calls registerJobHandler', () => {
    const own = new Set(['src/lib/jobs/handlers.ts', 'src/lib/jobs/register-all.ts']);
    const registering = walk(path.join(ROOT, 'src')).filter((f) => !own.has(f) && /\bregisterJobHandler(<[^>]*>)?\(/.test(read(f)));
    expect(registering.length).toBeGreaterThan(0);
    const source = read('src/lib/jobs/register-all.ts');
    const imported = new Set(
      [...source.matchAll(/from '([^']+)'/g)].map(([, spec]) => (spec!.startsWith('@/') ? `src/${spec!.slice(2)}` : `src/lib/jobs/${spec!.replace(/^\.\//, '')}`) + '.ts'),
    );
    for (const file of registering) expect(imported, `${file} registers a job handler but src/lib/jobs/register-all.ts does not import it`).toContain(file);
  });

  it('is loaded by every runner entry point', () => {
    for (const entry of ['src/app/api/jobs/run/route.ts', 'src/app/api/uploads/jobs/run/route.ts', 'src/app/api/media-ai/jobs/run/route.ts', 'src/lib/jobs/cli.ts']) {
      expect(read(entry), entry).toMatch(/import '(@\/lib\/jobs|\.)\/register-all';/);
    }
  });
});

describe('claiming by type', () => {
  it('claim with a type filter leaves jobs of other types untouched', async () => {
    const db = await getDb();
    const now = new Date('2026-09-26T12:00:00Z');
    const q = new JobQueue(db, () => now);
    const mine = await q.enqueue({ type: 'jobs_test.mine', runAt: new Date(now.getTime() - 1000) });
    const other = await q.enqueue({ type: 'jobs_test.not_mine', runAt: new Date(now.getTime() - 2000) });

    expect(await q.claim('w', 10, { types: [] })).toEqual([]);
    const claimed = await q.claim('w', 10, { types: ['jobs_test.mine'] });
    expect(claimed.map((j) => j.id)).toEqual([mine.id]);

    const untouched = (await q.get(other.id))!;
    expect(untouched).toMatchObject({ status: 'queued', attempts: 0, lockedBy: null, lastError: null });
  });

  it('runDueJobs never claims (and so never kills) a job whose handler is not registered here', async () => {
    const db = await getDb();
    const ran: string[] = [];
    registerJobHandler('jobs_test.registered', async (_p, job) => {
      ran.push(job.id);
    });
    const q = new JobQueue(db);
    const orphan = await q.enqueue({ type: 'jobs_test.unregistered', maxAttempts: 1 });
    const runnable = await q.enqueue({ type: 'jobs_test.registered' });

    for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'register-all-test', limit: 100 });

    expect(ran).toEqual([runnable.id]);
    expect((await q.get(runnable.id))!.status).toBe('succeeded');
    // Before the filter this was claimed, failed with "no handler registered" and, at maxAttempts 1, dead.
    expect(await q.get(orphan.id)).toMatchObject({ status: 'queued', attempts: 0, lastError: null });
  });

  it('stops claiming once its time budget is spent, leaving the rest queued rather than locked', async () => {
    const db = await getDb();
    registerJobHandler('jobs_test.slow', async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    const q = new JobQueue(db);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await q.enqueue({ type: 'jobs_test.slow' })).id);

    const summary = await runDueJobs(db, { worker: 'budget-test', limit: 10, types: ['jobs_test.slow'], budgetMs: 100 });

    // Two fit in 100ms of 60ms jobs (the budget is checked before each claim); none is claimed after it.
    expect(summary.claimed).toBeGreaterThanOrEqual(1);
    expect(summary.claimed).toBeLessThan(5);
    expect(summary.succeeded).toBe(summary.claimed);
    const rows = await Promise.all(ids.map((id) => q.get(id)));
    const left = rows.filter((r) => r!.status === 'queued');
    expect(left).toHaveLength(5 - summary.claimed);
    for (const r of left) expect(r).toMatchObject({ attempts: 0, lockedBy: null });
  });
});
