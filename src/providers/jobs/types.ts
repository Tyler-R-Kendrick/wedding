import type { ProviderDescriptor } from '@/contracts/providers';
import type { JobRow } from '@/db/schema';
import type { EnqueueInput, RunSummary } from '@/lib/jobs';

/** The durable queue exposed as a provider so health/config reporting is uniform. */
export interface JobsProvider extends ProviderDescriptor {
  kind: 'jobs';
  enqueue(input: EnqueueInput): Promise<JobRow>;
  runDue(opts?: { limit?: number; worker?: string }): Promise<RunSummary>;
  counts(): Promise<Record<string, number>>;
}
