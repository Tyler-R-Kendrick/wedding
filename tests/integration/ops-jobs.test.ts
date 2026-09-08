import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminCancelJob, adminJobsOverview, adminRetryJob } from '@/capabilities/ops';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { clearJobHandlers, JobQueue, registerJobHandler, runDueJobs } from '@/lib/jobs';
import { expectErr, expectOk, run } from './helpers/swarm-e';

const admin = (entitlements: string[] = ['admin_integrations']): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD-JOB' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(entitlements as never),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'job-session',
});

let failing = 0;

beforeAll(() => {
  clearJobHandlers();
  registerJobHandler('ops_test.always_fails', async () => {
    failing++;
    throw new Error('handler exploded');
  });
  registerJobHandler('ops_test.succeeds', async () => {});
});
afterAll(() => clearJobHandlers());

describe('admin_jobs_overview', () => {
  it('requires admin_integrations', async () => {
    expect(expectErr(await run(adminJobsOverview, admin(['admin_lifecycle']), {})).code).toBe('forbidden');
  });

  it('counts by status and type, and flags a type with no registered handler', async () => {
    const db = await getDb();
    const queue = new JobQueue(db);
    await queue.enqueue({ type: 'ops_test.succeeds' });
    await queue.enqueue({ type: 'ops_test.orphaned' }); // nothing registers this
    const o = expectOk(await run(adminJobsOverview, admin(), {})).data;
    expect(o.byStatus.queued).toBeGreaterThanOrEqual(2);
    expect(o.dueNow).toBeGreaterThanOrEqual(2);
    expect(o.oldestDueAgeSeconds).not.toBeNull();
    const orphan = o.byType.find((t) => t.type === 'ops_test.orphaned')!;
    expect(orphan.handlerRegistered).toBe(false);
    expect(o.byType.find((t) => t.type === 'ops_test.succeeds')!.handlerRegistered).toBe(true);
  });

  it('never returns a job payload', async () => {
    // Payloads are arbitrary handler input and routinely name a guest or an asset; the page needs
    // the type and the last error, not the input.
    const db = await getDb();
    await new JobQueue(db).enqueue({ type: 'ops_test.succeeds', payload: { guestId: 'G-PRIVATE', email: 'someone@example.com' } });
    const o = expectOk(await run(adminJobsOverview, admin(), {})).data;
    const rendered = JSON.stringify(o);
    expect(rendered).not.toContain('G-PRIVATE');
    expect(rendered).not.toContain('someone@example.com');
    expect(rendered).not.toContain('payload');
  });
});

describe('retrying and cancelling', () => {
  it('retries a dead job exactly once more, keeping the attempt history', async () => {
    const db = await getDb();
    const queue = new JobQueue(db);
    const job = await queue.enqueue({ type: 'ops_test.always_fails', maxAttempts: 1 });
    await runDueJobs(db, { worker: 'test', limit: 20 });
    expect((await queue.get(job.id))!.status).toBe('dead');
    const before = failing;

    const retried = expectOk(await run(adminRetryJob, admin(), { jobId: job.id })).data;
    expect(retried.status).toBe('queued');
    expect(retried.attempts).toBe(1); // history kept, not reset
    expect(retried.maxAttempts).toBe(2); // exactly one more run allowed

    await runDueJobs(db, { worker: 'test', limit: 20 });
    expect(failing).toBe(before + 1);
    expect((await queue.get(job.id))!.status).toBe('dead'); // and then it stops again
  });

  it('refuses to retry a job that is not failed or dead, and says why', async () => {
    const db = await getDb();
    const job = await new JobQueue(db).enqueue({ type: 'ops_test.succeeds' });
    const e = expectErr(await run(adminRetryJob, admin(), { jobId: job.id }));
    expect(e.code).toBe('conflict');
    expect(e.details).toMatchObject({ status: 'queued' });
  });

  it('answers not_found for an id that is not a job', async () => {
    expect(expectErr(await run(adminRetryJob, admin(), { jobId: newId() })).code).toBe('not_found');
  });

  it('cancels a queued job, releases its dedupe key, and will not cancel a finished one', async () => {
    const db = await getDb();
    const queue = new JobQueue(db);
    const job = await queue.enqueue({ type: 'ops_test.succeeds', dedupeKey: 'ops-test-dedupe' });
    const cancelled = expectOk(await run(adminCancelJob, admin(), { jobId: job.id })).data;
    expect(cancelled.status).toBe('dead');
    expect(cancelled.dedupeKey).toBeNull();
    expect(cancelled.lastError).toContain('cancelled by admin');

    // The key is free again, so the same work can be re-enqueued rather than silently de-duplicated.
    const replacement = await queue.enqueue({ type: 'ops_test.succeeds', dedupeKey: 'ops-test-dedupe' });
    expect(replacement.id).not.toBe(job.id);

    await runDueJobs(db, { worker: 'test', limit: 20 });
    expect(expectErr(await run(adminCancelJob, admin(), { jobId: replacement.id })).code).toBe('conflict');
  });

  it('is not offered to agent surfaces', async () => {
    expect(adminRetryJob.exposure).toEqual({ ui: true, ai: false, webmcp: false });
    expect(adminCancelJob.exposure).toEqual({ ui: true, ai: false, webmcp: false });
    expect(adminJobsOverview.exposure).toEqual({ ui: true, ai: false, webmcp: false });
  });
});
