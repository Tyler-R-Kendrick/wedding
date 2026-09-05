import type { Db } from '@/db/client';
import { JobQueue, runDueJobs, type EnqueueInput } from '@/lib/jobs';
import { okConfig, upHealth } from '../base';
import type { JobsProvider } from './types';

export * from './types';

export class DbJobs implements JobsProvider {
  readonly kind = 'jobs' as const;
  readonly name = 'db-queue';
  readonly mode = 'live' as const;
  readonly capabilities = { enqueue: true, runDue: true, retries: true };
  private readonly queue: JobQueue;
  constructor(private readonly db: Db) {
    this.queue = new JobQueue(db);
  }
  validateConfig() {
    return okConfig();
  }
  async health() {
    const counts = await this.queue.countByStatus();
    return upHealth(JSON.stringify(counts));
  }
  enqueue(input: EnqueueInput) {
    return this.queue.enqueue(input);
  }
  runDue(opts: { limit?: number; worker?: string } = {}) {
    return runDueJobs(this.db, opts);
  }
  counts() {
    return this.queue.countByStatus();
  }
}

export function createJobsProvider(deps: { db: Db }): JobsProvider {
  return new DbJobs(deps.db);
}
