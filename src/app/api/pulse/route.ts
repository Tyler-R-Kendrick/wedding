import { cleanDiagnostics } from '@/lib/diagnostics/scrub';
import { fromThisSite, MemoryWindow, readCapped } from '@/lib/feedback/guards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Where every visitor's browser reports an error it caught (src/lib/diagnostics/recorder.ts): the
 * error, and the last fifty steps that led to it, as one structured log line and one counter.
 *
 * It takes no identity and looks none up. The report says which page, which build, which browser
 * and what happened in what order; it never says who. The visit id in it is random per tab and is
 * the same one a problem report from that tab would carry, which is how the two are joined.
 *
 * Self-contained for the same reason the reporter is (src/app/api/feedback/route.ts): no database,
 * no validated environment. It answers 204 whatever happens, because the caller is a beacon from a
 * page that is already in trouble and has nothing to do with a failure here.
 */
const MAX_BYTES = 64 * 1024;
/** Per address and overall, per warm function. A page sends at most five (recorder.ts). */
const perClient = new MemoryWindow(30, 60_000);
const overall = new MemoryWindow(600, 60_000, 1);

const done = (): Response => new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });

/** Rate-limit key only; never logged, never stored. */
function clientKey(request: Request): string {
  const forwarded = (process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for') : null) ?? request.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',').pop()?.trim().slice(0, 64) || 'direct';
}

export async function POST(request: Request): Promise<Response> {
  if (!fromThisSite(request)) return done();
  if (!overall.allow('all') || !perClient.allow(clientKey(request))) return done();
  try {
    const bytes = await readCapped(request, MAX_BYTES);
    if (!bytes || bytes.byteLength === 0) return done();
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { type?: unknown; diagnostics?: unknown };
    if (body?.type !== 'error') return done();
    const d = cleanDiagnostics(body.diagnostics);
    const error = d?.errors.at(-1);
    if (!d || !error) return done();
    const [{ logger }, { metrics }] = await Promise.all([import('@/lib/logger'), import('@/lib/metrics')]);
    logger.warn(
      {
        client: { visit: d.session, build: d.build, path: d.path, viewport: d.viewport, userAgent: d.userAgent, online: d.online, openMs: d.startedAt ? d.capturedAt - d.startedAt : undefined, ...(d.links ? { links: d.links } : {}) },
        error,
        steps: d.breadcrumbs.map((c) => `${new Date(c.t).toISOString().slice(11, 23)} ${c.kind} ${c.text}`),
      },
      'client error',
    );
    metrics.counter('client.error', 1, { source: error.source });
  } catch {
    // Unreadable, or the logger itself is unwell. Either way the page cannot use an error from here.
  }
  return done();
}
