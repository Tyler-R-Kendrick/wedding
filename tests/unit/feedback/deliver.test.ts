import { describe, expect, it } from 'vitest';
import { deliverQueuedReport, deliverReport, reportIssue, type DeliverDeps, type QueuedReport } from '@/lib/feedback/deliver';
import type { FeedbackReport } from '@/lib/feedback/report';
import { MockIssueTracker, UnconfiguredIssueTracker } from '@/providers/issue-tracker';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);
const report = (extra: Partial<FeedbackReport> = {}): FeedbackReport => ({
  ref: 'FB-ABC123',
  receivedAt: '2026-11-16T20:00:00.000Z',
  kind: 'bug',
  message: 'The seating page is blank.',
  page: { path: '/admin/seating', title: 'Seating' },
  reporter: { adminId: 'ADMIN_01HZX', via: 'pass' },
  diagnostics: null,
  ...extra,
});

/** Every rung recorded, none of them real. */
function rig(overrides: Partial<DeliverDeps> = {}) {
  const logs: { level: string; fields: Record<string, unknown>; message: string }[] = [];
  const queued: QueuedReport[] = [];
  const emails: { subject: string; text: string }[] = [];
  const records: Record<string, unknown>[] = [];
  const deps: DeliverDeps = {
    enqueue: async (payload) => {
      queued.push(payload);
      return true;
    },
    email: async (subject, text) => {
      emails.push({ subject, text });
      return true;
    },
    log: (level, fields, message) => logs.push({ level, fields, message }),
    record: async (properties) => {
      records.push(properties);
      return true;
    },
    ...overrides,
  };
  return { deps, logs, queued, emails, records };
}

describe('delivering a report', () => {
  it('files it in the tracker and stops there', async () => {
    const tracker = new MockIssueTracker();
    const { deps, logs, queued, emails } = rig({ tracker });
    const delivery = await deliverReport(report({ screenshot: { filename: 'fb.png', contentType: 'image/png', bytes: PNG } }), deps);
    expect(delivery).toEqual({ via: 'tracker', key: 'MOCK-1', url: 'https://tracker.invalid/MOCK-1', screenshotStored: true });
    expect(tracker.issues[0]).toMatchObject({ title: 'Bug: The seating page is blank.' });
    expect(queued).toHaveLength(0);
    expect(emails).toHaveLength(0);
    // Filed: the log has the reference, not a second copy of the report.
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: 'info', fields: { issue: 'MOCK-1' } });
    expect(logs[0]!.fields.report).toBeUndefined();
  });

  it('queues it for the cron and emails the couple when the tracker does not answer', async () => {
    const tracker = new MockIssueTracker();
    tracker.failNext = 1;
    const { deps, logs, queued, emails } = rig({ tracker });
    const delivery = await deliverReport(report({ screenshot: { filename: 'fb.png', contentType: 'image/png', bytes: PNG } }), deps);
    expect(delivery).toEqual({ via: 'queue', emailed: true, recorded: true });
    expect(queued[0]).toMatchObject({ ref: 'FB-ABC123', title: 'Bug: The seating page is blank.', screenshot: { filename: 'fb.png', contentType: 'image/png' } });
    expect(emails[0]!.subject).toBe('[Site feedback] FB-ABC123: Bug: The seating page is blank.');
    expect(logs[0]).toMatchObject({ level: 'warn', fields: { failure: 'mock: server', queued: true, emailed: true } });
    expect(String(logs[0]!.fields.report)).toContain('The seating page is blank.');
  });

  it('does not queue a report no retry could file: emails it instead', async () => {
    const { deps, queued, emails } = rig({ tracker: new UnconfiguredIssueTracker() });
    expect(await deliverReport(report(), deps)).toEqual({ via: 'email', recorded: true });
    expect(queued).toHaveLength(0);
    expect(emails).toHaveLength(1);
  });

  it('leaves the whole report in the log when nothing else would take it', async () => {
    const tracker = new MockIssueTracker();
    tracker.failNext = 1;
    const { deps, logs } = rig({ tracker, enqueue: async () => false, email: async () => false, record: async () => false });
    expect(await deliverReport(report(), deps)).toEqual({ via: 'log', recorded: false });
    expect(logs[0]!.level).toBe('error');
    expect(String(logs[0]!.fields.report)).toContain('FB-ABC123');
  });

  it('survives every rung throwing', async () => {
    const boom = async () => {
      throw new Error('database is down');
    };
    const { deps, logs } = rig({
      tracker: { ...new MockIssueTracker(), kind: 'issue-tracker', capabilities: { createIssue: true, attachments: true }, createIssue: boom, validateConfig: () => ({ ok: true, missing: [], warnings: [] }), health: boom, name: 'broken', mode: 'live' },
      enqueue: boom,
      email: boom,
      record: boom,
    });
    expect(await deliverReport(report(), deps)).toEqual({ via: 'log', recorded: false });
    expect(logs[0]!.fields.failure).toBe('broken: timeout');
  });

  it('does not carry a large screenshot into the queue', async () => {
    const tracker = new MockIssueTracker();
    tracker.failNext = 1;
    const { deps, queued } = rig({ tracker });
    const big = new Uint8Array(1_200_000);
    big.set(PNG);
    await deliverReport(report({ screenshot: { filename: 'fb.png', contentType: 'image/png', bytes: big } }), deps);
    expect(queued[0]!.screenshot).toBeUndefined();
  });
});

describe('the PostHog record of a report', () => {
  it('carries everything the sync needs to file it, tied to the session it was made in', async () => {
    const { deps, records } = rig({ tracker: new UnconfiguredIssueTracker() });
    const withSession = report({
      screenshot: { filename: 'fb.png', contentType: 'image/png', bytes: PNG },
      diagnostics: { session: 'abcdef0123456789', build: 'a1b2c3d', path: '/admin/seating', title: 'Seating', viewport: '', userAgent: '', language: '', timeZone: '', online: true, startedAt: 0, capturedAt: 0, errors: [], breadcrumbs: [], links: { session: '0195c1a2-aaaa-7bbb-8ccc-1234567890ab' } },
    });
    await deliverReport(withSession, deps);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ref: 'FB-ABC123', kind: 'bug', title: 'Bug: The seating page is blank.', page: '/admin/seating', reporter: 'ADMIN_01HZX', filed: 'email', has_screenshot: true, build: 'a1b2c3d', $session_id: '0195c1a2-aaaa-7bbb-8ccc-1234567890ab' });
    expect(String(records[0]!.body)).toContain('> The seating page is blank.');
    // No picture in an event: the bytes stay out.
    expect(JSON.stringify(records[0])).not.toContain('iVBOR');
    expect(records[0]!.issue_key).toBeUndefined();
  });

  it('says where a filed report went, so the sync leaves it alone', async () => {
    const { deps, records } = rig({ tracker: new MockIssueTracker() });
    await deliverReport(report(), deps);
    expect(records[0]).toMatchObject({ filed: 'tracker', issue_key: 'MOCK-1', issue_url: 'https://tracker.invalid/MOCK-1' });
  });

  it('counts as somewhere the report is kept: a recorded report is not an error in the log', async () => {
    const tracker = new MockIssueTracker();
    tracker.failNext = 1;
    const { deps, logs } = rig({ tracker, enqueue: async () => false, email: async () => false });
    expect(await deliverReport(report(), deps)).toEqual({ via: 'log', recorded: true });
    expect(logs[0]!.level).toBe('warn');
  });
});

describe('the retry job', () => {
  it('files a queued report, screenshot and all', async () => {
    const tracker = new MockIssueTracker();
    const issue = reportIssue(report());
    const filed = await deliverQueuedReport({ ref: 'FB-ABC123', title: issue.title, body: issue.body, screenshot: { filename: 'fb.png', contentType: 'image/png', base64: Buffer.from(PNG).toString('base64') } }, tracker);
    expect(filed.key).toBe('MOCK-1');
    expect(tracker.issues[0]!.attachments?.[0]?.bytes).toEqual(PNG);
  });

  it('throws when the tracker still refuses, so the queue backs off and tries again', async () => {
    const tracker = new MockIssueTracker();
    tracker.failNext = 1;
    await expect(deliverQueuedReport({ ref: 'FB-ABC123', title: 't', body: 'b' }, tracker)).rejects.toThrow(/FB-ABC123.*mock: server/);
  });

  it('ignores a queued attachment that is not one of the three picture types', async () => {
    const tracker = new MockIssueTracker();
    await deliverQueuedReport({ ref: 'FB-1', title: 't', body: 'b', screenshot: { filename: 'x.svg', contentType: 'image/svg+xml', base64: 'AAAA' } }, tracker);
    expect(tracker.issues[0]!.attachments).toBeUndefined();
  });
});
