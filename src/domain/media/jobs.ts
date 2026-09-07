import type { Db } from '@/db/client';
import { env } from '@/lib/env';
import { JobQueue, registerJobHandler, type JobHandler } from '@/lib/jobs';
import { limitsFromEnv } from '@/lib/media/limits';
import { getProvider } from '@/providers/registry';
import { purgeSoftDeleted } from './assets';
import { deriveAsset, markStuckAssets, processAsset, type PipelineDeps } from './pipeline';
import { expireStaleUploads, MEDIA_DERIVE_JOB, MEDIA_PROCESS_JOB, MEDIA_SWEEP_JOB } from './uploads';

/**
 * Job handlers for the media pipeline. Registered at module load (same pattern as
 * src/lib/jobs/housekeeping.ts); `registerMediaJobs()` is exported for explicit callers.
 * Every handler uses the runner's `ctx.db` and resolves providers through the registry.
 */
export function pipelineDeps(db: Db, now?: () => Date): PipelineDeps {
  return {
    db,
    storage: getProvider('storage', { db }),
    video: getProvider('video', { db }),
    limits: limitsFromEnv(env),
    now,
  };
}

const process: JobHandler<{ assetId: string }> = async (payload, _job, ctx) => {
  if (typeof payload.assetId !== 'string') throw new Error('media.process: assetId required');
  const result = await processAsset(pipelineDeps(ctx.db, () => ctx.now), payload.assetId);
  ctx.logger.info({ assetId: payload.assetId, ...result }, 'media.process');
};

const derive: JobHandler<{ assetId: string }> = async (payload, _job, ctx) => {
  if (typeof payload.assetId !== 'string') throw new Error('media.derive: assetId required');
  const result = await deriveAsset(pipelineDeps(ctx.db, () => ctx.now), payload.assetId);
  ctx.logger.info({ assetId: payload.assetId, ...result }, 'media.derive');
};

const sweep: JobHandler = async (_payload, _job, ctx) => {
  const deps = pipelineDeps(ctx.db, () => ctx.now);
  const expired = await expireStaleUploads({ db: ctx.db, storage: deps.storage, now: () => ctx.now });
  const stuck = await markStuckAssets(ctx.db, ctx.now);
  const purged = await purgeSoftDeleted(ctx.db, deps.storage, ctx.now);
  ctx.logger.info({ expired, stuck, purged }, 'media.sweep');
};

export function registerMediaJobs(): void {
  registerJobHandler(MEDIA_PROCESS_JOB, process);
  registerJobHandler(MEDIA_DERIVE_JOB, derive);
  registerJobHandler(MEDIA_SWEEP_JOB, sweep);
}

/** Keeps one sweep queued (deduped); called from the media cron alias. */
export async function enqueueMediaSweep(db: Db): Promise<void> {
  await new JobQueue(db).enqueue({ type: MEDIA_SWEEP_JOB, dedupeKey: MEDIA_SWEEP_JOB, maxAttempts: 3 });
}

registerMediaJobs();
