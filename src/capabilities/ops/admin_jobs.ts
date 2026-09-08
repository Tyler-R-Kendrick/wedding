import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { ID_PATTERN } from '@/contracts/ids';
import { err, ok } from '@/contracts/result';
import { JOB_STATUSES } from '@/db/schema';
import { jobsOverview, toJobRowView } from '@/domain/ops';
import { JobQueue } from '@/lib/jobs';
import { opsDb } from './_shared';

const jobRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(JOB_STATUSES),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  runAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  lockedBy: z.string().nullable(),
  lockedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  dedupeKey: z.string().nullable(),
  handlerRegistered: z.boolean(),
});

const overviewInput = z.object({ attentionLimit: z.number().int().min(1).max(100).optional(), recentLimit: z.number().int().min(1).max(100).optional() }).optional();
const overviewOutput = z.object({
  byStatus: z.record(z.string(), z.number().int()),
  byType: z.array(z.object({ type: z.string(), total: z.number().int(), queued: z.number().int(), running: z.number().int(), succeeded: z.number().int(), dead: z.number().int(), handlerRegistered: z.boolean() })),
  dueNow: z.number().int(),
  oldestDueAgeSeconds: z.number().int().nullable(),
  idleHandlers: z.array(z.string()),
  attention: z.array(jobRowSchema),
  recent: z.array(jobRowSchema),
});
export type JobsOverviewView = z.infer<typeof overviewOutput>;

/**
 * Queue depth and the rows an operator has to decide about. Job payloads are never returned: a
 * payload is arbitrary handler input and routinely names a guest, an asset or an upload, none of
 * which this screen needs to say that a job is stuck.
 */
export const adminJobsOverview = defineCapability<z.infer<typeof overviewInput>, JobsOverviewView>({
  name: 'admin_jobs_overview',
  title: 'Background jobs',
  description: 'Queue depth by status and type, how long the oldest due job has been waiting, which handler types are registered in this process, and the failed/dead rows with their last error. Payloads are not included. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_integrations'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: overviewInput,
  output: overviewOutput,
  maxOutputChars: 80_000,
  async handler(ctx, i) {
    return ok({ data: await jobsOverview(opsDb(ctx), ctx.now, { attentionLimit: i?.attentionLimit, recentLimit: i?.recentLimit }), sources: [] });
  },
});

const jobIdInput = z.object({ jobId: z.string().regex(ID_PATTERN) });

export const adminRetryJob = defineCapability<z.infer<typeof jobIdInput>, z.infer<typeof jobRowSchema>>({
  name: 'admin_retry_job',
  title: 'Retry a job',
  description: 'Puts one failed or dead job back on the queue to run now, allowing exactly one more attempt. Attempt history is kept. A running or already-succeeded job is refused. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_integrations'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input: jobIdInput,
  output: jobRowSchema,
  async handler(ctx, i) {
    const db = opsDb(ctx);
    const queue = new JobQueue(db, () => ctx.now);
    const row = await queue.requeue(i.jobId);
    if (!row) {
      const current = await queue.get(i.jobId);
      if (!current) return err(new CapabilityError('not_found', 'No job with that id.'));
      return err(new CapabilityError('conflict', `A ${current.status} job cannot be retried; only failed or dead ones can.`, { status: current.status }));
    }
    return ok({ data: toJobRowView(row), sources: [] });
  },
});

export const adminCancelJob = defineCapability<z.infer<typeof jobIdInput>, z.infer<typeof jobRowSchema>>({
  name: 'admin_cancel_job',
  title: 'Cancel a job',
  description: 'Stops a queued job from running: it becomes dead with a recorded reason and releases its de-duplication key. A running job is refused — cancelling it would leave a worker holding the row. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_integrations'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input: jobIdInput,
  output: jobRowSchema,
  async handler(ctx, i) {
    const db = opsDb(ctx);
    const queue = new JobQueue(db, () => ctx.now);
    const row = await queue.cancel(i.jobId, `cancelled by admin at ${ctx.now.toISOString()}`);
    if (!row) {
      const current = await queue.get(i.jobId);
      if (!current) return err(new CapabilityError('not_found', 'No job with that id.'));
      return err(new CapabilityError('conflict', `A ${current.status} job cannot be cancelled; only a queued one can.`, { status: current.status }));
    }
    return ok({ data: toJobRowView(row), sources: [] });
  },
});
