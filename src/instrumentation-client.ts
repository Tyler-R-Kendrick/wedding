import { addBreadcrumb, installRecorder } from '@/lib/diagnostics/recorder';
import { scrubPath } from '@/lib/diagnostics/scrub';
import { observeConfig } from '@/lib/observe/config';

/**
 * Runs in every visitor's browser before React starts (Next's client instrumentation hook).
 *
 * Two layers of tracing, both for everyone:
 *
 *  1. The flight recorder (src/lib/diagnostics/recorder.ts), now, synchronously. A few kilobytes of
 *     the site's own code, no account, nothing sent unless something breaks. It is what catches a
 *     failure during hydration, and what a problem report attaches.
 *  2. PostHog (src/lib/observe/posthog-client.ts), later and only when a project token is
 *     configured: session replay, exceptions, web vitals, the console. Its SDK is large, so it is a
 *     separate chunk requested a moment after the page has loaded, when the browser is idle. Without a token
 *     the chunk is never requested.
 */
try {
  installRecorder();
} catch {
  // Tracing never stops a page from starting.
}

const config = observeConfig();
if (config) {
  const start = () => {
    import('@/lib/observe/posthog-client').then(
      ({ startPostHog }) => startPostHog(config),
      () => addBreadcrumb('note', 'session tracker did not load'),
    );
  };
  // Measured on the production build: the chunk is about 200 kB on the wire. Requested the instant
  // `load` fires, it would be parsed just as a guest starts to scroll or tap, so it waits a second
  // more and then for an idle moment. Errors in that gap are not lost: the recorder above has them
  // and hands them over when the SDK arrives.
  const whenIdle = () =>
    window.setTimeout(() => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(start, { timeout: 3_000 }) : start()), 1_200);
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
}

export function onRouterTransitionStart(url: string, navigationType: 'push' | 'replace' | 'traverse'): void {
  addBreadcrumb('nav', `${navigationType} to ${scrubPath(url)}`);
}
