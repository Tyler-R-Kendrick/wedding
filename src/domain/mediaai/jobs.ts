import type { Db } from '@/db/client';
import { env } from '@/lib/env';
import { getFlags, isReady } from '@/lib/flags';
import { JobQueue, registerJobHandler, type JobHandler } from '@/lib/jobs';
import { getProvider } from '@/providers/registry';
import { recomputeClusters } from './clusters';
import { indexAsset, listIndexBacklog, type IndexerDeps } from './indexer';

/**
 * Job handlers for media intelligence. `media.index` either indexes one asset (`{ assetId }`) or
 * scans the backlog (`{ scan: true }`) and fans out one deduped job per asset; `media.cluster`
 * recomputes bursts and duplicate groups. Registered at module load, like Swarm H's handlers;
 * the media-ai cron alias (`/api/media-ai/jobs/run`) imports this module so production cron
 * knows them too.
 */
export const MEDIA_INDEX_JOB = 'media.index';
export const MEDIA_CLUSTER_JOB = 'media.cluster';
export const INDEX_SCAN_BATCH = 25;

export function indexerDeps(db: Db, now?: () => Date): IndexerDeps {
  return {
    db,
    storage: getProvider('storage', { db }),
    mediaAi: getProvider('media-ai', { db }),
    embeddings: getProvider('embeddings', { db }),
    vectorIndex: getProvider('vector-index', { db }),
    flags: getFlags(),
    readiness: (flag) => isReady(flag, db),
    now,
  };
}

export async function enqueueIndex(db: Db, assetId: string, now: Date = new Date()): Promise<void> {
  await new JobQueue(db, () => now).enqueue({ type: MEDIA_INDEX_JOB, payload: { assetId }, dedupeKey: `${MEDIA_INDEX_JOB}:${assetId}`, maxAttempts: 4 });
}

/**
 * Keeps one backlog scan and one cluster pass queued (deduped); called from the cron alias and the
 * admin reindex. `full` rebuilds every indexable asset rather than only what changed since the
 * last pass (new embeddings model, different vector backend, flag change).
 */
export async function enqueueIndexScan(db: Db, now: Date = new Date(), opts: { full?: boolean } = {}): Promise<void> {
  const queue = new JobQueue(db, () => now);
  const scan = opts.full ? 'scan:full' : 'scan';
  await queue.enqueue({ type: MEDIA_INDEX_JOB, payload: { scan: true, full: !!opts.full }, dedupeKey: `${MEDIA_INDEX_JOB}:${scan}`, maxAttempts: 3 });
  await queue.enqueue({ type: MEDIA_CLUSTER_JOB, dedupeKey: MEDIA_CLUSTER_JOB, maxAttempts: 3 });
}

const index: JobHandler<{ assetId?: string; scan?: boolean; full?: boolean }> = async (payload, _job, ctx) => {
  if (payload.scan) {
    const ids = await listIndexBacklog(ctx.db, env.JOBS_BATCH_SIZE * 5 || INDEX_SCAN_BATCH, { full: !!payload.full });
    for (const assetId of ids) await enqueueIndex(ctx.db, assetId, ctx.now);
    ctx.logger.info({ enqueued: ids.length, full: !!payload.full }, 'media.index scan');
    return;
  }
  if (typeof payload.assetId !== 'string') throw new Error('media.index: assetId or scan required');
  const result = await indexAsset(indexerDeps(ctx.db, () => ctx.now), payload.assetId);
  ctx.logger.info({ assetId: payload.assetId, ...result }, 'media.index');
};

const cluster: JobHandler = async (_payload, _job, ctx) => {
  const counts = await recomputeClusters(ctx.db, ctx.now);
  ctx.logger.info(counts, 'media.cluster');
};

export function registerMediaAiJobs(): void {
  registerJobHandler(MEDIA_INDEX_JOB, index);
  registerJobHandler(MEDIA_CLUSTER_JOB, cluster);
}

registerMediaAiJobs();
