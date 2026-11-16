import { cleanDiagnostics, scrubPath } from '@/lib/diagnostics/scrub';
import type { Diagnostics } from '@/lib/diagnostics/types';
import { FEEDBACK_KIND_LABELS, FEEDBACK_KINDS, MAX_MESSAGE_CHARS, MAX_SCREENSHOT_BYTES, type FeedbackKind } from './constants';

/**
 * A problem report: what the reporter wrote, where they were, and what the flight recorder saw.
 * Parsing and rendering only, with no I/O, so the endpoint, the retry job and the tests share one
 * definition of what a report is and how it reads as an issue.
 *
 * The reporter's own words are kept as written: they chose them, and they go to a private tracker.
 * Everything captured automatically is scrubbed (src/lib/diagnostics/scrub.ts).
 */
export interface Screenshot {
  filename: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Uint8Array;
}

export interface FeedbackReport {
  /** `FB-7K2M9Q`: what the reporter is shown, and what the logs and the issue carry. */
  ref: string;
  receivedAt: string;
  kind: FeedbackKind;
  message: string;
  page: { path: string; title: string };
  reporter: { adminId: string; via: 'session' | 'pass' };
  diagnostics: Diagnostics | null;
  screenshot?: Screenshot;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newReportRef(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return `FB-${[...random(6)].map((b) => CROCKFORD[b % 32]).join('')}`;
}

export type ParsedReport = { ok: true; value: Pick<FeedbackReport, 'kind' | 'message' | 'page' | 'diagnostics'> } | { ok: false; reason: 'empty' | 'too_long' };

/**
 * Reads a report from whatever arrived: the widget's JSON, or the plain form's fields (where
 * `diagnostics` is absent or a JSON string). Unknown fields are ignored; wrong types become their
 * empty value. The only things it refuses are no message at all and one far past the limit.
 */
export function parseReport(raw: Record<string, unknown>): ParsedReport {
  const message = typeof raw.message === 'string' ? raw.message.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim() : '';
  if (!message) return { ok: false, reason: 'empty' };
  if (message.length > MAX_MESSAGE_CHARS) return { ok: false, reason: 'too_long' };
  const kind = FEEDBACK_KINDS.includes(raw.kind as FeedbackKind) ? (raw.kind as FeedbackKind) : 'bug';
  let diagnosticsRaw: unknown = raw.diagnostics;
  if (typeof diagnosticsRaw === 'string') {
    try {
      diagnosticsRaw = JSON.parse(diagnosticsRaw);
    } catch {
      diagnosticsRaw = null;
    }
  }
  const diagnostics = cleanDiagnostics(diagnosticsRaw);
  const path = scrubPath(typeof raw.path === 'string' ? raw.path : '') || diagnostics?.path || '';
  const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim().slice(0, 120) : (diagnostics?.title ?? '');
  return { ok: true, value: { kind, message, page: { path, title }, diagnostics } };
}

/** jpeg, png or webp by their first bytes; what the browser called the file is not evidence. */
export function sniffImage(bytes: Uint8Array): Screenshot['contentType'] | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export function toScreenshot(bytes: Uint8Array, ref: string): Screenshot | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SCREENSHOT_BYTES) return null;
  const contentType = sniffImage(bytes);
  if (!contentType) return null;
  return { filename: `${ref.toLowerCase()}.${contentType === 'image/jpeg' ? 'jpg' : contentType.slice(6)}`, contentType, bytes };
}

// --- rendering -------------------------------------------------------------------------------

/** `@name` notifies a person on GitHub and Linear; a zero-width space after the `@` stops that. */
const defang = (s: string): string => s.replace(/@(?=[A-Za-z0-9_-])/g, '@​');
/** Inside a code fence the only thing that can break out is another fence. */
const fenced = (s: string): string => s.replace(/`{3,}/g, "'''");
const inline = (s: string): string => s.replace(/`/g, "'");
const clock = (t: number): string => (t > 0 ? new Date(t).toISOString().slice(11, 23) : '--:--:--.---');

export function reportTitle(report: Pick<FeedbackReport, 'message' | 'kind'>): string {
  const first = (report.message.split('\n').find((line) => line.trim()) ?? '').replace(/\s+/g, ' ').trim();
  const text = first.length > 90 ? `${first.slice(0, 89).trimEnd()}…` : first;
  return defang(`${report.kind === 'idea' ? 'Idea' : report.kind === 'content' ? 'Content' : 'Bug'}: ${text}`);
}

/** The issue body, as markdown both GitHub and Linear render. */
export function reportBody(report: FeedbackReport): string {
  const d = report.diagnostics;
  const lines: string[] = [];
  lines.push(defang(report.message.split('\n').map((l) => `> ${l}`).join('\n')));
  lines.push('');
  lines.push(`**${FEEDBACK_KIND_LABELS[report.kind]}** · reported from the site by owner \`${inline(report.reporter.adminId)}\``);
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push(`| Reference | \`${report.ref}\` |`);
  lines.push(`| When | ${report.receivedAt} |`);
  lines.push(`| Page | \`${inline(report.page.path || 'unknown')}\`${report.page.title ? ` (${defang(report.page.title.replace(/\|/g, '/'))})` : ''} |`);
  if (d) {
    lines.push(`| Build | \`${d.build}\` |`);
    lines.push(`| Visit | \`${d.session}\`${d.startedAt ? `, page open ${Math.max(0, Math.round((d.capturedAt - d.startedAt) / 1000))}s` : ''} |`);
    lines.push(`| Screen | ${d.viewport || 'unknown'}${d.online ? '' : ', offline'} |`);
    lines.push(`| Browser | ${inline(d.userAgent).replace(/\|/g, '/') || 'unknown'} |`);
    if (d.language || d.timeZone) lines.push(`| Locale | ${[d.language, d.timeZone].filter(Boolean).join(', ')} |`);
    if (d.links?.replay) lines.push(`| Session replay | [watch the session](${d.links.replay}) |`);
    else if (d.links?.session) lines.push(`| PostHog session | \`${d.links.session}\` |`);
  }
  if (d?.errors.length) {
    lines.push('');
    lines.push(`### Errors on the page (${d.errors.length})`);
    for (const e of d.errors) {
      lines.push('');
      lines.push('```');
      lines.push(fenced(`${clock(e.t)} [${e.source}]${e.digest ? ` digest ${e.digest}` : ''} ${e.message}`));
      if (e.stack) lines.push(fenced(e.stack));
      lines.push('```');
    }
  }
  if (d?.breadcrumbs.length) {
    lines.push('');
    lines.push(`### What led up to it (last ${d.breadcrumbs.length} steps, oldest first)`);
    lines.push('');
    lines.push('```');
    for (const c of d.breadcrumbs) lines.push(fenced(`${clock(c.t)} ${c.kind.padEnd(7)} ${c.text}`));
    lines.push('```');
  }
  if (!d) {
    lines.push('');
    lines.push('_Sent from the plain form: the page could not attach what it recorded._');
  }
  return lines.join('\n');
}

/** The same report as plain text, for the email rung and the log. */
export function reportText(report: FeedbackReport): string {
  return `${reportTitle(report)}\n\n${reportBody(report)}`.replace(/​/g, '');
}
