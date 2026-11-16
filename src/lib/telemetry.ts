/**
 * The switch and the server-side reporter for first-party visit telemetry
 * (docs/ops/admin-guide.md, "Telemetry"). Deliberately imports nothing at the top: it is loaded
 * from `src/instrumentation.ts`, where everything heavy is loaded on first use.
 */

const FALSY = new Set(['0', 'false', 'off', 'no']);

/**
 * `TELEMETRY=off` (or `0`, `false`, `no`) records nothing. Read on every call rather than once at
 * import, so one process can be switched without a rebuild and a test can switch it at all;
 * `src/lib/env.ts` declares the same variable, so a malformed value still fails at boot.
 */
export function telemetryEnabled(source: Record<string, string | undefined> = process.env): boolean {
  return !FALSY.has((source.TELEMETRY ?? '').trim().toLowerCase());
}

/** The half of Next's `onRequestError` arguments this reads. Headers are in the real one and are never touched. */
export interface RequestErrorInfo {
  path?: string;
  method?: string;
}

export interface RequestErrorContext {
  routePath?: string;
  routeType?: string;
}

/** At most this many server errors are written per process per minute; a failing page in a loop is one fault, not ten thousand rows. */
export const SERVER_ERRORS_PER_MINUTE = 30;
const budget = { windowStart: 0, used: 0 };

function withinBudget(nowMs: number): boolean {
  if (nowMs - budget.windowStart >= 60_000) {
    budget.windowStart = nowMs;
    budget.used = 0;
  }
  budget.used += 1;
  return budget.used <= SERVER_ERRORS_PER_MINUTE;
}

/** Tests: forget how many errors this process has written in the current minute. */
export function resetServerErrorBudget(): void {
  budget.windowStart = 0;
  budget.used = 0;
}

/**
 * Records an error the server hit while answering a request, as a `source: 'server'` error event.
 * Keeps the error's name, message and top frames and the request's pathname; the query string is
 * cut off, and headers and cookies are never read. Never throws: a fault in the fault recorder
 * must not become a second error on the page.
 */
export async function reportRequestError(error: unknown, request: RequestErrorInfo | undefined, context?: RequestErrorContext): Promise<void> {
  try {
    if (!telemetryEnabled()) return;
    // Next throws these to steer a render (`notFound()`, `redirect()`); they are not faults.
    const digest = typeof error === 'object' && error !== null && 'digest' in error ? String((error as { digest?: unknown }).digest) : '';
    if (/^(?:NEXT_|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(digest)) return;
    const now = new Date();
    if (!withinBudget(now.getTime())) return;
    const e = error instanceof Error ? error : null;
    const [{ getDb }, { recordServerError }] = await Promise.all([import('@/db/client'), import('@/domain/ops/telemetry')]);
    await recordServerError(await getDb(), {
      // The address the visitor asked for; the route file's own path when Next gives no address.
      path: request?.path || context?.routePath || '/',
      name: e?.name ?? null,
      message: e ? e.message : typeof error === 'string' ? error : 'Unknown error',
      stack: e?.stack ?? null,
      now,
      root: process.cwd(),
    });
  } catch {
    // Swallowed on purpose (the database is down, the table is not migrated yet): the request's own error is already being reported by Next.
  }
}
