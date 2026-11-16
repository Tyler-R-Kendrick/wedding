import type { Instrumentation } from 'next';
import { scrubPath, scrubStack, scrubText } from '@/lib/diagnostics/scrub';

/**
 * A server-side failure, as Next reports it to `onRequestError` (src/instrumentation.ts): a page
 * that would not render, a route handler or server action that threw.
 *
 * The line it writes carries the `digest`, which is the "Reference" the error page shows the reader
 * (src/components/errors/PageError.tsx) and the id a problem report quotes. Before this, that
 * reference was on the guest's screen and nowhere on the server.
 *
 * When PostHog is connected the failure is sent there too (./posthog-server.ts), joined to the
 * visitor's session by the id their browser put on the request.
 */
export const recordRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  try {
    const digest = typeof error === 'object' && error !== null && 'digest' in error ? String((error as { digest: unknown }).digest).slice(0, 64) : undefined;
    const isError = error instanceof Error;
    const [{ logger }, { metrics }] = await Promise.all([import('@/lib/logger'), import('@/lib/metrics')]);
    logger.error(
      {
        digest,
        // No query values: an invitation token or a preview pass can be in them.
        request: { method: request.method, path: scrubPath(request.path) },
        route: { path: context.routePath, type: context.routeType, source: context.renderSource, revalidate: context.revalidateReason },
        failure: { name: isError ? error.name : typeof error, message: scrubText(isError ? error.message : String(error), 500), stack: isError ? scrubStack(error.stack) : undefined },
      },
      'request failed',
    );
    metrics.counter('server.error', 1, { type: context.routeType });
    const { sendServerException } = await import('./posthog-server');
    await sendServerException(error, request.headers, { digest, route: context.routePath, routeType: context.routeType, method: request.method, path: scrubPath(request.path), build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev' });
  } catch {
    // Reporting a failure must never be a second one.
  }
};
