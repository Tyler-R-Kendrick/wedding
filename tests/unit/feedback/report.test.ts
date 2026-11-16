import { describe, expect, it } from 'vitest';
import { newReportRef, parseReport, reportBody, reportText, reportTitle, sniffImage, toScreenshot, type FeedbackReport } from '@/lib/feedback/report';
import { MAX_MESSAGE_CHARS, MAX_SCREENSHOT_BYTES } from '@/lib/feedback/constants';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe('parseReport', () => {
  it('takes the widget’s JSON', () => {
    const parsed = parseReport({ kind: 'content', message: '  The hotel block date is wrong.  ', path: '/travel?x=1', title: 'Travel', diagnostics: { session: 'abcdef0123456789', build: 'a1b2c3d', path: '/travel' } });
    expect(parsed).toMatchObject({ ok: true, value: { kind: 'content', message: 'The hotel block date is wrong.', page: { path: '/travel?x', title: 'Travel' } } });
    if (parsed.ok) expect(parsed.value.diagnostics?.session).toBe('abcdef0123456789');
  });

  it('takes the plain form’s fields, where there are no diagnostics', () => {
    const parsed = parseReport({ kind: 'bug', message: 'Nothing loads', path: '/rsvp' });
    expect(parsed).toMatchObject({ ok: true, value: { diagnostics: null, page: { path: '/rsvp', title: '' } } });
  });

  it('reads diagnostics sent as a JSON string, and survives ones that are not JSON', () => {
    const good = parseReport({ message: 'x', diagnostics: JSON.stringify({ session: 'abcdef0123456789', path: '/gifts' }) });
    expect(good.ok && good.value.page.path).toBe('/gifts');
    const bad = parseReport({ message: 'x', diagnostics: '{not json' });
    expect(bad.ok && bad.value.diagnostics).toBeNull();
  });

  it('defaults an unknown kind to a bug', () => {
    const parsed = parseReport({ kind: 'rant', message: 'x' });
    expect(parsed.ok && parsed.value.kind).toBe('bug');
  });

  it('refuses only an empty message and one past the limit', () => {
    expect(parseReport({ message: '   ' })).toEqual({ ok: false, reason: 'empty' });
    expect(parseReport({})).toEqual({ ok: false, reason: 'empty' });
    expect(parseReport({ message: 'x'.repeat(MAX_MESSAGE_CHARS + 1) })).toEqual({ ok: false, reason: 'too_long' });
    expect(parseReport({ message: 'x'.repeat(MAX_MESSAGE_CHARS) }).ok).toBe(true);
  });
});

describe('screenshots', () => {
  it('are recognised by their bytes, not their name', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it('are named after the report, and refused when empty or too large', () => {
    expect(toScreenshot(PNG, 'FB-ABC123')).toMatchObject({ filename: 'fb-abc123.png', contentType: 'image/png' });
    expect(toScreenshot(JPEG, 'FB-ABC123')?.filename).toBe('fb-abc123.jpg');
    expect(toScreenshot(new Uint8Array(), 'FB-ABC123')).toBeNull();
    const huge = new Uint8Array(MAX_SCREENSHOT_BYTES + 1);
    huge.set(PNG);
    expect(toScreenshot(huge, 'FB-ABC123')).toBeNull();
  });
});

describe('rendering a report as an issue', () => {
  const report: FeedbackReport = {
    ref: 'FB-7K2M9Q',
    receivedAt: '2026-11-16T20:03:00.000Z',
    kind: 'bug',
    message: 'The RSVP button does nothing for @grandma.\nSecond line with ``` a fence.',
    page: { path: '/rsvp', title: 'RSVP | Sara + Tyler' },
    reporter: { adminId: 'ADMIN_01HZX', via: 'pass' },
    diagnostics: {
      session: 'abcdef0123456789',
      build: 'a1b2c3d',
      path: '/rsvp',
      title: 'RSVP',
      viewport: '390x844@3',
      userAgent: 'Mozilla/5.0 (iPhone)',
      language: 'en-US',
      timeZone: 'America/Chicago',
      online: true,
      startedAt: 1_700_000_000_000,
      capturedAt: 1_700_000_042_000,
      errors: [{ t: 1_700_000_040_000, source: 'boundary', message: 'TypeError: x is undefined ``` @someone', digest: '2468013579', stack: 'TypeError: x\n    at Step' }],
      breadcrumbs: [{ t: 1_700_000_039_000, kind: 'click', text: 'button.btn.btn--primary[type=submit]' }],
      links: { session: '0195c1a2-aaaa-7bbb-8ccc-1234567890ab', replay: 'https://us.posthog.com/project/1/replay/0195c1a2?t=30' },
    },
  };

  it('titles it from the first line, by kind, within a tracker’s title length', () => {
    expect(reportTitle(report)).toBe('Bug: The RSVP button does nothing for @​grandma.');
    expect(reportTitle({ kind: 'idea', message: 'x'.repeat(300) }).length).toBeLessThanOrEqual(100);
    expect(reportTitle({ kind: 'content', message: '\n\n  Wrong date  ' })).toBe('Content: Wrong date');
  });

  it('quotes the reporter’s words and never lets them notify anyone', () => {
    const body = reportBody(report);
    expect(body).toContain('> The RSVP button does nothing for @​grandma.');
    expect(body).not.toMatch(/@grandma/);
  });

  it('carries the reference, page, build, visit and the replay link', () => {
    const body = reportBody(report);
    for (const piece of ['`FB-7K2M9Q`', '`/rsvp`', '`a1b2c3d`', '`abcdef0123456789`, page open 42s', '390x844@3', '[watch the session](https://us.posthog.com/project/1/replay/0195c1a2?t=30)', 'owner `ADMIN_01HZX`']) expect(body).toContain(piece);
  });

  it('keeps captured text inside its code fence', () => {
    const body = reportBody(report);
    expect(body).toContain("TypeError: x is undefined ''' @someone");
    expect(body).toContain('digest 2468013579');
    // Fences open and close in pairs: nothing captured can end one early.
    expect((body.match(/^```$/gm) ?? []).length % 2).toBe(0);
  });

  it('says so when the plain form sent it with nothing attached', () => {
    expect(reportBody({ ...report, diagnostics: null })).toContain('Sent from the plain form');
  });

  it('reads as plain text for email and the log', () => {
    expect(reportText(report)).not.toContain('​');
    expect(reportText(report).startsWith('Bug: The RSVP button')).toBe(true);
  });

  it('makes references that are easy to read aloud', () => {
    const ref = newReportRef(() => new Uint8Array([0, 31, 32, 63, 255, 7]));
    expect(ref).toBe('FB-0Z0ZZ7');
    expect(newReportRef()).toMatch(/^FB-[0-9A-HJKMNP-TV-Z]{6}$/);
  });
});
