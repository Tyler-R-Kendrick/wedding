'use client';

import { AdminFlow } from '@/components/admin/flow/AdminFlow';
import { CheckField, Consequences } from '@/components/admin/flow/fields';
import { QuickAction } from '@/components/admin/flow/QuickAction';

export interface JobSummary {
  id: string;
  type: string;
  /** Already formatted by the page, in the wedding's time zone. */
  runAt: string;
}

/** One more attempt for a failed or dead job. Easy to undo (cancel it again), so one click. */
export function RetryJob({ job }: { job: Pick<JobSummary, 'id' | 'type'> }) {
  return (
    <QuickAction
      label="Retry"
      busyLabel="Retrying…"
      done={`The ${job.type} job is queued to run again.`}
      accessibleName={`Retry the ${job.type} job`}
      calls={[{ capability: 'admin_retry_job', input: { jobId: job.id } }]}
    />
  );
}

/** Stops a queued job from running. A running one is held by a worker and is refused by the capability. */
export function CancelJobFlow({ job }: { job: JobSummary }) {
  return (
    <AdminFlow<{ confirmed: boolean }>
      id={`jobs:cancel:${job.id}`}
      tone="danger"
      title={`Cancel the ${job.type} job`}
      trigger={{ label: 'Cancel', variant: 'danger', accessibleName: `Cancel the ${job.type} job` }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: `Cancel the ${job.type} job?`,
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>
                  The {job.type} job due {job.runAt} will not run. It is marked dead with a recorded reason, and its de-duplication key is released, so the same work can be
                  queued again.
                </p>
                <p>It moves to “Needs a decision”, where Retry puts it back on the queue.</p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label="Yes, cancel this job" />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: `Cancel the ${job.type} job`, capability: 'admin_cancel_job', input: () => ({ jobId: job.id }), success: `The ${job.type} job is cancelled; it will not run.` }}
    />
  );
}
