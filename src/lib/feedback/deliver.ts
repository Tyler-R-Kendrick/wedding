import type { IssueAttachment, IssueTrackerProvider, NewIssue } from '@/providers/issue-tracker/types';
import { reportBody, reportText, reportTitle, type FeedbackReport } from './report';

/**
 * Getting a report somewhere it will be read. Four rungs, tried in order, each one needing less of
 * the site to be working than the one before:
 *
 *   1. the issue tracker (Linear or GitHub), where a report becomes work to be triaged;
 *   2. the job queue, when the tracker is configured but did not answer: the report is kept in the
 *      database and filed by the next runs of the cron, for about an hour;
 *   3. an email to the couple, when the tracker could not take it now;
 *   4. the server log, always, with the whole report in it whenever rung 1 was not reached.
 *
 * Beside the ladder, every report is recorded in PostHog as a `problem_report` event when PostHog
 * is connected. That copy is what makes Linear work with no API key at all: a scheduled task reads
 * the reports no tracker took and files them into the `wedding` team (docs/ops/observability.md).
 * With a key, rung 1 files at once and the task finds nothing to do.
 *
 * Every dependency is loaded inside a try: the provider registry, the queue, the database, the
 * mailer, even the logger. A report is most likely to be filed when something is broken, so none of
 * them is allowed to be the reason it is lost.
 */
export const FEEDBACK_DELIVER_JOB = 'feedback.deliver';
/** Screenshots above this are not carried into the queue (the payload is a database row). */
const MAX_QUEUED_SCREENSHOT_BYTES = 1_000_000;

export type Delivery =
  | { via: 'tracker'; key: string; url: string; screenshotStored: boolean }
  | { via: 'queue'; emailed: boolean; recorded: boolean }
  | { via: 'email'; recorded: boolean }
  | { via: 'log'; recorded: boolean };

/** The event a report is recorded as. The scheduled sync reads these. */
export const PROBLEM_REPORT_EVENT = 'problem_report';

export interface DeliverDeps {
  tracker?: IssueTrackerProvider;
  /** Returns true when the retry was stored. */
  enqueue?: (payload: QueuedReport) => Promise<boolean>;
  /** Returns true when at least one owner was written to. */
  email?: (subject: string, text: string) => Promise<boolean>;
  log?: (level: 'info' | 'warn' | 'error', fields: Record<string, unknown>, message: string) => void;
  /** Returns true when the report was recorded in PostHog. */
  record?: (properties: Record<string, unknown>) => Promise<boolean>;
}

export interface QueuedReport extends Record<string, unknown> {
  ref: string;
  title: string;
  body: string;
  screenshot?: { filename: string; contentType: string; base64: string };
}

export function reportIssue(report: FeedbackReport): NewIssue {
  return {
    title: reportTitle(report),
    body: reportBody(report),
    ...(report.screenshot ? { attachments: [report.screenshot] } : {}),
  };
}

async function loadTracker(): Promise<IssueTrackerProvider | null> {
  try {
    return (await import('@/providers/registry')).getProvider('issue-tracker');
  } catch {
    // The registry loads the validated environment. If that is what is broken, build the tracker
    // from the raw variables it needs and nothing else.
    try {
      return (await import('@/providers/issue-tracker')).createIssueTrackerProvider(process.env);
    } catch {
      return null;
    }
  }
}

async function defaultEnqueue(payload: QueuedReport): Promise<boolean> {
  try {
    const [{ getDb }, { JobQueue }] = await Promise.all([import('@/db/client'), import('@/lib/jobs/queue')]);
    await new JobQueue(await getDb()).enqueue({ type: FEEDBACK_DELIVER_JOB, payload, dedupeKey: `feedback:${payload.ref}`, maxAttempts: 8 });
    return true;
  } catch {
    return false;
  }
}

async function defaultEmail(subject: string, text: string): Promise<boolean> {
  try {
    const owners = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e)).slice(0, 4);
    if (owners.length === 0) return false;
    const mailer = (await import('@/providers/registry')).getProvider('auth-email');
    const sent = await Promise.all(owners.map((to) => mailer.sendMessage({ to, subject, text }).then((r) => r.ok, () => false)));
    return sent.some(Boolean);
  } catch {
    return false;
  }
}

function defaultLog(level: 'info' | 'warn' | 'error', fields: Record<string, unknown>, message: string): void {
  import('@/lib/logger').then(
    ({ logger }) => logger[level](fields, message),
    () => console[level === 'info' ? 'log' : level](message, JSON.stringify(fields)),
  );
}

async function defaultRecord(properties: Record<string, unknown>): Promise<boolean> {
  try {
    const { sendServerEvent } = await import('@/lib/observe/posthog-server');
    return await sendServerEvent(PROBLEM_REPORT_EVENT, `owner:${String(properties.reporter)}`, properties);
  } catch {
    return false;
  }
}

/** The report as the event's properties: everything the sync needs to file it, and no screenshot. */
function recordOf(report: FeedbackReport, issue: NewIssue, filed: Delivery['via'], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: report.ref,
    kind: report.kind,
    title: issue.title,
    body: issue.body.slice(0, 30_000),
    page: report.page.path,
    reporter: report.reporter.adminId,
    filed,
    has_screenshot: !!report.screenshot,
    build: report.diagnostics?.build,
    // Ties the report to the session it was made in, so it shows on that session's replay.
    ...(report.diagnostics?.links?.session ? { $session_id: report.diagnostics.links.session } : {}),
    ...extra,
  };
}

const within = <T>(work: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms).unref?.())]).catch(() => fallback);

export async function deliverReport(report: FeedbackReport, deps: DeliverDeps = {}): Promise<Delivery> {
  const log = deps.log ?? defaultLog;
  const record = deps.record ?? defaultRecord;
  const about = { ref: report.ref, kind: report.kind, page: report.page.path, reporter: report.reporter.adminId, via: report.reporter.via, build: report.diagnostics?.build, visit: report.diagnostics?.session };
  const issue = reportIssue(report);
  const tracker = deps.tracker ?? (await loadTracker());

  let failure = 'no tracker';
  if (tracker?.capabilities.createIssue) {
    const created = await within(tracker.createIssue(issue), 20_000, null);
    if (created?.ok) {
      const screenshotStored = created.value.attachmentsStored > 0;
      // Recorded too, with where it went: the sync leaves a report that already has an issue alone.
      const recorded = await within(record(recordOf(report, issue, 'tracker', { issue_key: created.value.key, issue_url: created.value.url })), 4_000, false);
      log('info', { feedback: about, tracker: tracker.name, issue: created.value.key, recorded }, 'problem report filed');
      return { via: 'tracker', key: created.value.key, url: created.value.url, screenshotStored };
    }
    failure = created ? `${tracker.name}: ${created.error.class}` : `${tracker.name}: timeout`;
  } else if (tracker) {
    failure = `${tracker.name}: unconfigured`;
  }

  // Worth another try later only if a tracker exists and the refusal was not about its settings.
  const retryable = !!tracker?.capabilities.createIssue && !failure.endsWith('unconfigured');
  const queued = retryable
    ? await within(
        (deps.enqueue ?? defaultEnqueue)({
          ref: report.ref,
          title: issue.title,
          body: issue.body,
          ...(report.screenshot && report.screenshot.bytes.byteLength <= MAX_QUEUED_SCREENSHOT_BYTES
            ? { screenshot: { filename: report.screenshot.filename, contentType: report.screenshot.contentType, base64: Buffer.from(report.screenshot.bytes).toString('base64') } }
            : {}),
        }),
        5_000,
        false,
      )
    : false;
  const emailed = await within((deps.email ?? defaultEmail)(`[Site feedback] ${report.ref}: ${issue.title}`.slice(0, 180), reportText(report)), 12_000, false);

  const via: Delivery['via'] = queued ? 'queue' : emailed ? 'email' : 'log';
  const recorded = await within(record(recordOf(report, issue, via)), 4_000, false);

  // The whole report goes in the log whenever the tracker did not take it: the last copy.
  log(queued || emailed || recorded ? 'warn' : 'error', { feedback: about, failure, queued, emailed, recorded, report: reportText(report) }, 'problem report not filed in the tracker');
  if (queued) return { via: 'queue', emailed, recorded };
  if (emailed) return { via: 'email', recorded };
  return { via: 'log', recorded };
}

/** The retry job's work: file a queued report. Throws on failure so the queue backs off and retries. */
export async function deliverQueuedReport(payload: QueuedReport, tracker: IssueTrackerProvider): Promise<{ key: string; url: string }> {
  const shot = payload.screenshot;
  const contentType = shot && (['image/jpeg', 'image/png', 'image/webp'] as const).find((type) => type === shot.contentType);
  const attachments: IssueAttachment[] | undefined = shot && contentType ? [{ filename: shot.filename, contentType, bytes: new Uint8Array(Buffer.from(shot.base64, 'base64')) }] : undefined;
  const created = await tracker.createIssue({ title: String(payload.title).slice(0, 200), body: String(payload.body), ...(attachments ? { attachments } : {}) });
  if (!created.ok) throw new Error(`issue tracker refused report ${payload.ref} (${created.error.provider}: ${created.error.class})`);
  return { key: created.value.key, url: created.value.url };
}
