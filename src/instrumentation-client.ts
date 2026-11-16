import posthog from 'posthog-js';

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (token && host) {
  posthog.init(token, {
    api_host: host,
    defaults: '2026-08-30',
    capture_exceptions: true,
    tracing_headers: [window.location.hostname],
    debug: process.env.NODE_ENV === 'development',
  });
} else if (process.env.NODE_ENV !== 'production') {
  // Say so, never throw: this file runs before the app's own scripts, so an error here stops every
  // page from becoming interactive wherever the variables are not set (a local checkout, the test
  // server, CI). `src/lib/posthog-logs.ts` reports the same gap the same way.
  const missingVariable = token ? 'NEXT_PUBLIC_POSTHOG_HOST' : 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN';
  console.warn(`${missingVariable} is not set, so PostHog is off and no events are sent. Set it to turn PostHog on.`);
}
