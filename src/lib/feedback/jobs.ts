import { registerJobHandler } from '@/lib/jobs/handlers';
import { getProvider } from '@/providers/registry';
import { deliverQueuedReport, FEEDBACK_DELIVER_JOB, type QueuedReport } from './deliver';

/** Files a report the tracker could not take when it was made (src/lib/feedback/deliver.ts, rung 2). */
export function registerFeedbackJobs(): void {
  registerJobHandler<QueuedReport>(FEEDBACK_DELIVER_JOB, async (payload, _job, ctx) => {
    const filed = await deliverQueuedReport(payload, getProvider('issue-tracker', { db: ctx.db }));
    ctx.logger.info({ feedback: { ref: payload.ref }, issue: filed.key }, 'queued problem report filed');
  });
}
