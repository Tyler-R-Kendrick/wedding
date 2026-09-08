import type { AnyCapability } from '@/contracts/capability';
import { adminCancelJob, adminJobsOverview, adminRetryJob } from './admin_jobs';
import { adminDisableFlagReadiness, adminFlagStatus } from './admin_flags';
import { adminLifecycleStatus } from './admin_lifecycle_status';
import { adminOpsMetrics } from './admin_ops_metrics';
import { adminProviderStatus } from './admin_provider_status';
import { adminSearchAudit } from './admin_search_audit';
import { adminPublishLifecycle, draftLifecycleTransition } from './publish_lifecycle';

/** Level 14: the cross-cutting admin console — lifecycle, audit, jobs, metrics, flags, providers. */
export const opsCapabilities: readonly AnyCapability[] = [
  adminLifecycleStatus,
  draftLifecycleTransition,
  adminPublishLifecycle,
  adminSearchAudit,
  adminJobsOverview,
  adminRetryJob,
  adminCancelJob,
  adminOpsMetrics,
  adminProviderStatus,
  adminFlagStatus,
  adminDisableFlagReadiness,
];

export { adminLifecycleStatus, draftLifecycleTransition, adminPublishLifecycle, adminSearchAudit, adminJobsOverview, adminRetryJob, adminCancelJob, adminOpsMetrics, adminProviderStatus, adminFlagStatus, adminDisableFlagReadiness };
export type { LifecycleStatus } from './admin_lifecycle_status';
export type { AuditSearchView } from './admin_search_audit';
export type { JobsOverviewView } from './admin_jobs';
export type { OpsMetricsView } from './admin_ops_metrics';
export type { ProviderStatusView } from './admin_provider_status';
export type { FlagStatusView } from './admin_flags';
