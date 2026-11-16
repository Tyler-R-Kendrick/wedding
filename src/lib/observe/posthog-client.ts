// The build with no script loader in it, and the extensions it would otherwise download, taken
// from the npm package: the code that runs is the code in the lockfile, reviewed like any other
// dependency, and `script-src 'self'` never has to trust a file a CDN serves at run time.
import posthog from 'posthog-js/dist/module.no-external';
import 'posthog-js/dist/posthog-recorder';
import 'posthog-js/dist/exception-autocapture';
import 'posthog-js/dist/tracing-headers';
import 'posthog-js/dist/web-vitals';
import { linkDiagnostics, snapshot, type Observer } from '@/lib/diagnostics/recorder';
import { scrubPath } from '@/lib/diagnostics/scrub';
import { isReplayUrl, OBSERVE_PATH, type ObserveConfig } from './config';

/**
 * Session tracing for every visitor, through PostHog: what they did (page views, clicks), what
 * went wrong (exceptions, with the server's when the request carried the session id), how the page
 * performed (web vitals, network timing), the console, and a replay of the session.
 *
 * It applies to everyone, so it is set to learn as little about anyone as still lets a failure be
 * debugged:
 *
 *  - Nobody is identified. No name, email, guest id or household reaches PostHog; a visitor is a
 *    random id that lasts for one browser tab (`persistence: 'sessionStorage'`, so no cookie either).
 *  - A replay shows the page's structure and the visitor's movement through it, not its content:
 *    every piece of text is masked, every input is masked, and pictures and video are replaced by
 *    blank boxes of the same size. The couple's photographs and the guests' names are never sent.
 *  - Autocapture records which control was used, never the words on it.
 *  - Addresses lose their query values before they are sent (an invitation token travels there).
 *  - No location: the proxy withholds the visitor's address and every event carries
 *    `$geoip_disable` (src/app/api/observe/[...path]/route.ts).
 *  - A browser that asks not to be tracked is not.
 *
 * Loaded on its own, after the page is interactive (src/instrumentation-client.ts), so the SDK's
 * weight is never between a guest and the first view.
 */
const URL_PROPERTIES = ['$current_url', '$referrer', '$prev_pageview_pathname', '$pathname', '$initial_current_url', '$initial_referrer', '$session_entry_url', '$session_entry_referrer'];

function scrubUrl(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return value;
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin ? `${url.origin}${scrubPath(url.pathname + url.search)}` : url.origin;
  } catch {
    return scrubPath(value);
  }
}

let started = false;

export function startPostHog(config: ObserveConfig): void {
  if (started) return;
  started = true;
  posthog.init(config.token, {
    api_host: OBSERVE_PATH,
    ui_host: config.uiHost,
    defaults: '2026-08-30',
    // Next redirects a trailing slash away; the proxy route puts it back for PostHog.
    rewriteRequestPath: (url) => {
      url.pathname = url.pathname.replace(/\/+$/, '');
      return url;
    },
    disable_external_dependency_loading: true,
    person_profiles: 'identified_only',
    persistence: 'sessionStorage',
    respect_dnt: true,
    disable_surveys: true,
    capture_dead_clicks: false,
    capture_exceptions: true,
    capture_performance: true,
    enable_recording_console_log: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    // Same-origin requests carry the session id, so a server-side failure joins this session.
    tracing_headers: [location.host],
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
      blockSelector: 'img, picture, video, canvas, [data-private]',
      maskCapturedNetworkRequestFn: (request) => {
        request.name = String(scrubUrl(request.name));
        return request;
      },
    },
    before_send: (event) => {
      if (!event) return event;
      const properties = event.properties ?? {};
      for (const key of URL_PROPERTIES) if (key in properties) properties[key] = scrubUrl(properties[key]);
      if (event.$set_once) for (const key of URL_PROPERTIES) if (key in event.$set_once) event.$set_once[key] = scrubUrl(event.$set_once[key]);
      return event;
    },
    loaded: (instance) => {
      (globalThis as typeof globalThis & { __weddingObserve?: Observer }).__weddingObserve = { link: linkPostHog, report: reportToPostHog };
      const recorded = snapshot();
      // `visit` is the flight recorder's id: the one a problem report and the server log carry.
      instance.register({ $geoip_disable: true, build: recorded.build, visit: recorded.session });
      // Errors from before the SDK arrived (it loads late on purpose) are not lost.
      for (const error of recorded.errors) {
        if (error.source === 'console') continue;
        const replayed = new Error(error.message);
        if (error.stack) replayed.stack = error.stack;
        instance.captureException(replayed, { early: true, source: error.source, ...(error.digest ? { digest: error.digest } : {}) });
      }
    },
  });
}

/** Puts this session's PostHog ids where a problem report picks them up. Cheap; call before a snapshot. */
export function linkPostHog(): void {
  if (!started) return;
  try {
    const replay = posthog.get_session_replay_url({ withTimestamp: true, timestampLookBack: 30 });
    linkDiagnostics({ session: posthog.get_session_id(), ...(isReplayUrl(replay) ? { replay } : {}) });
  } catch {
    // Not loaded far enough to know its own session yet.
  }
}

/** An error a boundary caught: autocapture never sees those, so each boundary reports its own. */
export function reportToPostHog(error: unknown, properties: Record<string, unknown> = {}): void {
  if (!started) return;
  try {
    posthog.captureException(error, properties);
  } catch {
    // Reporting must not fail the page that is already failing.
  }
}
