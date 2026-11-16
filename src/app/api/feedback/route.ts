import { MAX_REPORT_BYTES } from '@/lib/feedback/constants';
import { deliverReport, type Delivery } from '@/lib/feedback/deliver';
import { fallbackForm, fallbackThanks, safeFrom } from '@/lib/feedback/fallback-page';
import { fromThisSite, MemoryWindow, readCapped } from '@/lib/feedback/guards';
import { newReportRef, parseReport, toScreenshot, type FeedbackReport } from '@/lib/feedback/report';
import { clearReporterPassHeader, resolveReporter } from '@/lib/feedback/reporter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The problem reporter's endpoint. For Tyler and Sara only: every method answers 404 to anyone
 * without an owner's pass or session, so the address gives nothing away.
 *
 *   GET     the plain form (src/lib/feedback/fallback-page.ts)
 *   POST    file a report: JSON or multipart from the widget, multipart from the plain form
 *   DELETE  forget this device's pass (the widget calls it when it sees a sign-out)
 *
 * Built to answer when the rest of the site cannot. It imports no database, no validated
 * environment, no capability pipeline and no provider at module load: an owner is recognised by a
 * signed cookie (src/lib/feedback/pass.ts) and the report is delivered down a ladder whose last rung
 * is the server log (src/lib/feedback/deliver.ts). It is not a capability, deliberately: the
 * capability pipeline needs the database for its rate limits, its audit rows and its idempotency
 * keys, and "the database is down" is one of the reports this has to be able to take.
 */
const HTML = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } as const;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } as const;

/** Twelve reports in ten minutes from one owner is a person being thorough; more is a stuck key. */
const reports = new MemoryWindow(12, 10 * 60_000);

const notFound = (): Response => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

function respond(body: unknown, status: number, setCookie?: string): Response {
  const headers = new Headers(JSON_HEADERS);
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function html(body: string, status: number, setCookie?: string): Response {
  const headers = new Headers(HTML);
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(body, { status, headers });
}

export async function GET(request: Request): Promise<Response> {
  const { reporter, setCookie } = await resolveReporter(request);
  if (!reporter) return notFound();
  const url = new URL(request.url);
  const digest = url.searchParams.get('digest') ?? '';
  return html(fallbackForm({ from: safeFrom(url.searchParams.get('from')), ...(/^[A-Za-z0-9_@:-]{1,64}$/.test(digest) ? { digest } : {}) }), 200, setCookie);
}

/** What the reporter is told, by how far down the ladder the report went. */
function outcome(delivery: Delivery): string {
  if (delivery.via === 'tracker') return `Filed as ${delivery.key}.`;
  // Recorded in PostHog: the daily sync files it in Linear whatever else happened.
  const later = delivery.recorded ? ' It will be on the to-do list in Linear within a day.' : '';
  switch (delivery.via) {
    case 'queue':
      return delivery.recorded ? `Saved.${later}` : 'The to-do list did not answer just now, so the report is saved and will be filed in the next few minutes.';
    case 'email':
      return `Saved, and emailed to you both.${later}`;
    case 'log':
      return delivery.recorded ? `Saved.${later}` : 'The to-do list and email could not take it. The report is saved in the site’s log under this reference; tell Tyler the reference.';
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!fromThisSite(request)) return notFound();
  const { reporter, setCookie } = await resolveReporter(request);
  if (!reporter) return notFound();

  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  const isJson = contentType.startsWith('application/json');
  // The plain form is a navigation; the widget is a fetch that asks for JSON.
  const wantsPage = !isJson && (request.headers.get('accept') ?? '').includes('text/html') && request.headers.get('sec-fetch-dest') !== 'empty';
  const fail = (status: number, code: string, message: string, form: { from: string; message?: string } = { from: '' }): Response =>
    wantsPage ? html(fallbackForm({ ...form, error: message }), status, setCookie) : respond({ ok: false, error: code, message }, status, setCookie);

  if (!reports.allow(reporter.adminId)) return fail(429, 'rate_limited', 'That is a lot of reports in a few minutes. Wait a little and send it again.');

  let fields: Record<string, unknown> = {};
  let image: Uint8Array | null = null;
  try {
    if (isJson) {
      const bytes = await readCapped(request, MAX_REPORT_BYTES);
      if (!bytes) return fail(413, 'too_large', 'That report is too large to send.');
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (parsed && typeof parsed === 'object') fields = parsed as Record<string, unknown>;
    } else if (contentType.startsWith('multipart/form-data') || contentType.startsWith('application/x-www-form-urlencoded')) {
      const declared = Number(request.headers.get('content-length') ?? 0);
      if (!Number.isFinite(declared) || declared > MAX_REPORT_BYTES) return fail(413, 'too_large', 'That report is too large to send. Try a smaller screenshot.');
      const form = await request.formData();
      for (const key of ['message', 'kind', 'path', 'title', 'diagnostics', 'digest']) {
        const value = form.get(key);
        if (typeof value === 'string') fields[key] = value;
      }
      const file = form.get('screenshot');
      if (file && typeof file !== 'string' && file.size > 0) image = new Uint8Array(await file.arrayBuffer());
    } else {
      return fail(415, 'unsupported', 'That report could not be read.');
    }
  } catch {
    return fail(400, 'unreadable', 'That report could not be read.');
  }

  const from = safeFrom(typeof fields.path === 'string' ? fields.path : '');
  const parsed = parseReport(fields);
  if (!parsed.ok) {
    return fail(422, parsed.reason, parsed.reason === 'empty' ? 'Say what happened before sending.' : 'That is longer than a report can be. Trim it and send again.', { from, ...(typeof fields.message === 'string' ? { message: fields.message.slice(0, 4_000) } : {}) });
  }

  const ref = newReportRef();
  const screenshot = image ? toScreenshot(image, ref) : null;
  const report: FeedbackReport = { ref, receivedAt: new Date().toISOString(), ...parsed.value, reporter, ...(screenshot ? { screenshot } : {}) };
  // A digest typed into the plain form's hidden field is the only clue it has about the failure.
  if (!report.diagnostics && typeof fields.digest === 'string' && /^[A-Za-z0-9_@:-]{1,64}$/.test(fields.digest)) {
    report.message = `${report.message}\n\n(Error reference on the page: ${fields.digest})`;
  }

  const delivery = await deliverReport(report);
  const message = outcome(delivery);
  const screenshotNote = image && !screenshot ? ' The screenshot was not a picture this can take, so it was left out.' : screenshot && delivery.via === 'tracker' && !delivery.screenshotStored ? ' The screenshot could not be stored there.' : '';
  if (wantsPage) return html(fallbackThanks({ ref, where: message + screenshotNote, from }), delivery.via === 'tracker' ? 201 : 202, setCookie);
  return respond(
    { ok: true, ref, filed: delivery.via, message: message + screenshotNote, ...(delivery.via === 'tracker' ? { issue: { key: delivery.key, url: delivery.url } } : {}) },
    delivery.via === 'tracker' ? 201 : 202,
    setCookie,
  );
}

export async function DELETE(request: Request): Promise<Response> {
  if (!fromThisSite(request)) return notFound();
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearReporterPassHeader(request), 'Cache-Control': 'private, no-store' } });
}

