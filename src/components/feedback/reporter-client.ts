import { snapshot } from '@/lib/diagnostics/recorder';
import type { Diagnostics } from '@/lib/diagnostics/types';
import { FEEDBACK_PATH, REPORTER_EVENT, REPORTER_FLAG_KEY, REPORTER_OUTBOX_KEY, SCREENSHOT_MAX_EDGE, MAX_SCREENSHOT_BYTES, type FeedbackKind } from '@/lib/feedback/constants';

/**
 * The reporter's browser half, without React: whether this device is armed, how a report is sent,
 * and what happens to one the site could not take. The launcher and the dialog are thin over this.
 */

// --- armed ------------------------------------------------------------------------------------

const listeners = new Set<() => void>();

export function isArmed(): boolean {
  try {
    return localStorage.getItem(REPORTER_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function setArmed(armed: boolean): void {
  try {
    if (armed) localStorage.setItem(REPORTER_FLAG_KEY, '1');
    else localStorage.removeItem(REPORTER_FLAG_KEY);
  } catch {
    // Storage is blocked: the shortcut stays off on this device; the account menu still works.
  }
  for (const listener of listeners) listener();
}

export function subscribeArmed(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

// --- opening ----------------------------------------------------------------------------------

export interface ReportRequest {
  /** The error reference on the page the report is about, when it was opened from an error page. */
  digest?: string;
}

/** Opens the reporter from anywhere in the page. */
export function openReporter(request: ReportRequest = {}): void {
  window.dispatchEvent(new CustomEvent<ReportRequest>(REPORTER_EVENT, { detail: request }));
}

export function fallbackHref(request: ReportRequest = {}): string {
  const params = new URLSearchParams({ from: location.pathname });
  if (request.digest) params.set('digest', request.digest);
  return `${FEEDBACK_PATH}?${params}`;
}

// --- sending ----------------------------------------------------------------------------------

export interface ReportInput {
  kind: FeedbackKind;
  message: string;
  diagnostics: Diagnostics;
  screenshot?: Blob | null;
}

export type ReportOutcome =
  | { status: 'sent'; ref: string; message: string; issue?: { key: string; url: string } }
  /** The site could not be reached: the words are kept on this device and sent on a later visit. */
  | { status: 'saved' }
  /** This device's pass has gone (signed out elsewhere, or expired). */
  | { status: 'unrecognised' }
  | { status: 'refused'; message: string };

interface Queued {
  kind: FeedbackKind;
  message: string;
  path: string;
  title: string;
  diagnostics: Diagnostics;
  at: number;
}

function readOutbox(): Queued[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(REPORTER_OUTBOX_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Queued[]).slice(-10) : [];
  } catch {
    return [];
  }
}

function writeOutbox(items: Queued[]): void {
  try {
    if (items.length) localStorage.setItem(REPORTER_OUTBOX_KEY, JSON.stringify(items.slice(-10)));
    else localStorage.removeItem(REPORTER_OUTBOX_KEY);
  } catch {
    // Nothing more can be done from here; the dialog still offers the report as text to copy.
  }
}

async function post(body: BodyInit, json: boolean): Promise<Response> {
  return fetch(FEEDBACK_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body,
    signal: AbortSignal.timeout(45_000),
  });
}

async function readOutcome(res: Response): Promise<ReportOutcome | 'unreachable'> {
  if (res.status === 404) return { status: 'unrecognised' };
  // The function itself is down or timed out: the same as not reaching it.
  if (res.status >= 500) return 'unreachable';
  const body = (await res.json().catch(() => null)) as { ok?: boolean; ref?: string; message?: string; issue?: { key: string; url: string } } | null;
  if (res.ok && body?.ok && typeof body.ref === 'string') {
    return { status: 'sent', ref: body.ref, message: body.message ?? 'Sent.', ...(body.issue ? { issue: body.issue } : {}) };
  }
  return { status: 'refused', message: body?.message ?? 'That report could not be sent.' };
}

export async function sendReport(input: ReportInput): Promise<ReportOutcome> {
  const fields = { kind: input.kind, message: input.message, path: location.pathname, title: document.title, diagnostics: input.diagnostics };
  try {
    let res: Response;
    if (input.screenshot) {
      const form = new FormData();
      form.set('kind', fields.kind);
      form.set('message', fields.message);
      form.set('path', fields.path);
      form.set('title', fields.title);
      form.set('diagnostics', JSON.stringify(fields.diagnostics));
      form.set('screenshot', input.screenshot, 'screenshot');
      res = await post(form, false);
    } else {
      res = await post(JSON.stringify(fields), true);
    }
    const outcome = await readOutcome(res);
    if (outcome !== 'unreachable') return outcome;
  } catch {
    // Offline, blocked, timed out: fall through and keep the report.
  }
  // A screenshot is not kept: localStorage is small, and the words are what cannot be re-created.
  writeOutbox([...readOutbox(), { ...fields, at: Date.now() }]);
  return { status: 'saved' };
}

/** Sends reports kept from an earlier failure. Returns how many went. Quiet: it runs on page load. */
export async function flushOutbox(): Promise<number> {
  const queued = readOutbox();
  if (queued.length === 0 || !navigator.onLine) return 0;
  const kept: Queued[] = [];
  let sent = 0;
  for (const item of queued) {
    try {
      const { at, ...fields } = item;
      const waited = Math.round((Date.now() - at) / 60_000);
      const res = await post(JSON.stringify({ ...fields, message: `${fields.message}\n\n(Written ${waited} min before it could be sent: the site was unreachable.)` }), true);
      const outcome = await readOutcome(res);
      if (outcome === 'unreachable') kept.push(item);
      else if (outcome.status === 'sent') sent += 1;
      else if (outcome.status === 'unrecognised') kept.push(item);
      // 'refused' (too long, rate limited after a retry storm): dropped rather than retried forever.
    } catch {
      kept.push(item);
    }
  }
  writeOutbox(kept);
  return sent;
}

export const outboxCount = (): number => readOutbox().length;

/** The flight recorder's snapshot, taken when the dialog opens: what happened before the report, not during. */
export const captureDiagnostics = (): Diagnostics => snapshot();

/** The report as text, for the clipboard when nothing else works. */
export function reportAsText(input: Pick<ReportInput, 'kind' | 'message' | 'diagnostics'>): string {
  const d = input.diagnostics;
  return [
    `Wedding site report (${input.kind})`,
    input.message,
    '',
    `Page: ${d.path}`,
    `Build: ${d.build}  Visit: ${d.session}`,
    `Browser: ${d.userAgent}`,
    `Screen: ${d.viewport}`,
    ...d.errors.map((e) => `Error: ${e.message}${e.digest ? ` (digest ${e.digest})` : ''}`),
    ...d.breadcrumbs.slice(-15).map((c) => `${new Date(c.t).toISOString().slice(11, 19)} ${c.kind} ${c.text}`),
  ].join('\n');
}

// --- screenshot -------------------------------------------------------------------------------

/**
 * Scales a picture down to something a phone can upload on hotel Wi-Fi and the endpoint will take.
 * Returns null when the file is not a picture this browser can read.
 */
export async function prepareScreenshot(file: Blob): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, SCREENSHOT_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= MAX_SCREENSHOT_BYTES / 2 && /^image\/(jpeg|png|webp)$/.test(file.type)) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob && blob.size <= MAX_SCREENSHOT_BYTES ? blob : null;
  } catch {
    return /^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= MAX_SCREENSHOT_BYTES ? file : null;
  }
}
