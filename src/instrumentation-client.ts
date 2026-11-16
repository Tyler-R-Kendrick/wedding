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
} else if (process.env.NODE_ENV === 'development') {
  // Said, never thrown. This file runs before the page's own scripts: an error here stops React
  // from starting, so every button, form and flow on the site is dead wherever PostHog is not set
  // up. A checkout needs no account (CLAUDE.md), and neither does the test server CI runs.
  const missingVariable = token ? 'NEXT_PUBLIC_POSTHOG_HOST' : 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN';
  console.warn(`PostHog is off: ${missingVariable} is not set, so no events are sent from this browser.`);
}
