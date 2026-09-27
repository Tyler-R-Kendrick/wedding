import { describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { enqueueMediaSweep } from '@/domain/media/jobs';
import { runDueJobs } from '@/lib/jobs';

/**
 * Production ran with no object store configured, and building the storage provider threw ("this
 * host has an ephemeral filesystem…"). The media sweep built it up front, so it died on every cron
 * tick with nothing to sweep: three failed attempts, dead, queued again five minutes later. Here
 * building it throws the same way; with no uploads and no deleted assets the sweep must not need it.
 */
vi.mock('@/providers/registry', async (importOriginal) => {
  const registry = await importOriginal<typeof import('@/providers/registry')>();
  return {
    ...registry,
    getProvider: ((kind, deps) => {
      if (kind === 'storage') throw new Error('storage: this host has an ephemeral filesystem, so local-fs would drop every upload');
      return registry.getProvider(kind, deps);
    }) as typeof registry.getProvider,
  };
});

describe('the media sweep with no object store configured', () => {
  it('succeeds when there is nothing to clean up, instead of retrying to dead', async () => {
    const db = await getDb();
    await enqueueMediaSweep(db);
    const summary = await runDueJobs(db, { worker: 'sweep-test', types: ['media.sweep'] });
    expect(summary).toMatchObject({ claimed: 1, succeeded: 1, retried: 0, dead: 0 });
  });
});
