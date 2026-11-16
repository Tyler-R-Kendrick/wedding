import { z } from 'zod';
import { getDb } from '@/db/client';
import { recordTelemetry, SESSION_ID_PATTERN, TELEMETRY_MAX_EVENTS_PER_CALL } from '@/domain/ops';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getPrincipal } from '@/lib/principal';
import { assertSameOriginJson, getClientIp, jsonResponse, NO_STORE_HEADERS, readBodyText } from '@/lib/request';
import { telemetryEnabled } from '@/lib/telemetry';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';

/** A batch is at most twenty small events; an error's stack is the only long field and the client trims it. */
const TELEMETRY_MAX_BODY_BYTES = 16 * 1024;

const eventSchema = z.object({
  kind: z.enum(['view', 'error', 'vital']),
  path: z.string().min(1).max(2048),
  /** The browser's clock for the event, epoch milliseconds. Believed only when it is close to the server's. */
  at: z.number().finite().optional(),
  name: z.string().max(200).optional(),
  value: z.number().finite().optional(),
  message: z.string().max(4000).optional(),
  stack: z.string().max(12_000).optional(),
});

const bodySchema = z.object({
  sessionId: z.string().regex(SESSION_ID_PATTERN).optional(),
  events: z.array(eventSchema).min(1).max(TELEMETRY_MAX_EVENTS_PER_CALL * 2),
});

/** The one answer this route has. It says nothing about what was kept, limited or refused. */
const done = () => new Response(null, { status: 204, headers: NO_STORE_HEADERS });

/** `Sec-GPC: 1` (Global Privacy Control) or `DNT: 1`: this browser asked not to be tracked. */
const asksNotToBeTracked = (headers: Headers) => headers.get('sec-gpc')?.trim() === '1' || headers.get('dnt')?.trim() === '1';

/**
 * POST /api/telemetry  { sessionId?, events: [{ kind, path, at?, name?, value?, message?, stack? }] }  -> 204
 *
 * The browser beacon's door (src/components/telemetry/Telemetry.tsx). First-party only: a session
 * is a random id the tab made up, the User-Agent is read for a device class and a browser family
 * and then dropped, and the client address is used as the rate limiter's key and never stored.
 *
 * Order: the switch (`TELEMETRY=off` reads nothing), the same-origin JSON check (a `sendBeacon`
 * of an `application/json` Blob passes it; a form or another site's script does not), the per-IP
 * limiter, the hard body cap, the schema, then a second per-IP budget counted in events. A browser that sends `Sec-GPC: 1` or `DNT: 1` gets
 * no session and no page views or vitals stored; an error it reports is still kept, attached to
 * nothing, because a fault is about the site and not about the visitor.
 *
 * Every outcome is 204 with no body, so nothing can be learned by probing it.
 */
export async function POST(request: Request) {
  if (!telemetryEnabled()) return done();
  try {
    if (!assertSameOriginJson(request).ok) return done();

    const db = await getDb();
    const limiter = getProvider('rate-limit', { db });
    const ip = getClientIp(request.headers, env.TRUSTED_PROXY_HOPS);
    if (!(await limiter.consume(`telemetry:ip:${ip}`, 'telemetry')).allowed) return done();

    const raw = await readBodyText(request, TELEMETRY_MAX_BODY_BYTES);
    if (!raw.ok) return done();
    const body = bodySchema.safeParse(JSON.parse(raw.value));
    if (!body.success) return done();

    // One token per event: what bounds the rows one address can write, however it batches them.
    const cost = Math.min(body.data.events.length, TELEMETRY_MAX_EVENTS_PER_CALL);
    if (!(await limiter.consume(`telemetry:events:${ip}`, 'telemetryEvents', cost)).allowed) return done();

    const untracked = asksNotToBeTracked(request.headers);
    const sessionId = untracked ? null : (body.data.sessionId ?? null);
    // Who is asking only matters for naming a session; an untracked or sessionless batch never resolves one.
    const principal = sessionId ? await getPrincipal(request) : ({ kind: 'anonymous' } as const);
    await recordTelemetry(db, { sessionId, principal, userAgent: request.headers.get('user-agent'), events: body.data.events, now: new Date() });
  } catch (err) {
    // Malformed JSON, a database that is down or not migrated yet: the visitor's page is unaffected either way.
    if (!(err instanceof SyntaxError)) logger.warn({ err }, 'telemetry batch dropped');
  }
  return done();
}

export async function GET() {
  return jsonResponse({ ok: false, error: { code: 'validation', message: 'Use POST.' } }, { status: 405, headers: { Allow: 'POST' } });
}
