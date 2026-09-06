import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { getAuditSink } from '@/lib/audit';
import { env } from '@/lib/env';
import { JobQueue, registerJobHandler, type JobHandler } from '@/lib/jobs';
import { getProvider } from '@/providers/registry';
import { BIOMETRIC_DELETE_JOB, BIOMETRIC_SWEEP_JOB, runDeletion, sweepRetentionDetailed } from './deletion';
import { installBiometricConsentLookup } from './gate';

/**
 * Job handlers for the biometric vault. Deletion runs regardless of the feature flag: retention
 * and deletion obligations outlive the feature. Registered at module load; the media-ai cron
 * alias imports this module so production cron can run them.
 */
const del: JobHandler<{ deletionId: string; guestId: string }> = async (payload, _job, ctx) => {
  if (typeof payload.deletionId !== 'string') throw new Error('biometric.delete: deletionId required');
  const proof = await runDeletion(
    {
      db: ctx.db,
      biometric: getProvider('biometric', { db: ctx.db }),
      vectorIndex: getProvider('vector-index', { db: ctx.db }),
      audit: await getAuditSink(),
      now: ctx.now,
      requestId: ctx.requestId,
      component: `job:${BIOMETRIC_DELETE_JOB}`,
    },
    payload.deletionId,
  );
  ctx.logger.info({ deletionId: payload.deletionId, proof }, 'biometric.delete');
};

const sweep: JobHandler = async (_payload, _job, ctx) => {
  const swept = await sweepRetentionDetailed(ctx.db, { retentionDays: env.BIOMETRIC_RETENTION_DAYS, now: ctx.now, requestId: ctx.requestId });
  const byReason = swept.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] ?? 0) + 1 }), {});
  ctx.logger.info({ requested: swept.length, ...byReason }, 'biometric.sweep');
};

export function registerBiometricJobs(): void {
  registerJobHandler(BIOMETRIC_DELETE_JOB, del);
  registerJobHandler(BIOMETRIC_SWEEP_JOB, sweep);
}

/** Keeps one retention sweep queued (deduped); called from the media-ai cron alias. */
export async function enqueueBiometricSweep(db: Db, now: Date = new Date()): Promise<void> {
  await new JobQueue(db, () => now).enqueue({ type: BIOMETRIC_SWEEP_JOB, dedupeKey: BIOMETRIC_SWEEP_JOB, maxAttempts: 3 });
}

export const biometricJobRequestId = () => newId();

registerBiometricJobs();
installBiometricConsentLookup();
