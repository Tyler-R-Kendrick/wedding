/**
 * Whether the hosted session tracker (PostHog) is connected, and where it lives. Read by the
 * browser, the proxy route and the server hook, so it imports nothing.
 *
 * Two public variables, with the names PostHog's Vercel integration writes:
 *   NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN   the project token (`phc_…`). Public by design: every
 *                                       PostHog page ships its token to the browser.
 *   NEXT_PUBLIC_POSTHOG_HOST            the ingestion host, which says the region. Default US.
 *
 * Unset, everything in src/lib/observe is off: nothing is loaded, nothing is sent, the proxy
 * answers 404. A local checkout and the test suites need no account.
 */
export const OBSERVE_PATH = '/api/observe';

export interface ObserveConfig {
  token: string;
  region: 'us' | 'eu';
  /** Events, recordings, flags. */
  ingestHost: string;
  /** The SDK's own scripts and the project's remote config. */
  assetsHost: string;
  /** The PostHog app, for links to a replay. */
  uiHost: string;
}

const TOKEN = /^phc_[A-Za-z0-9]{20,80}$/;

export function observeConfig(
  token: string | undefined = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  host: string | undefined = process.env.NEXT_PUBLIC_POSTHOG_HOST,
): ObserveConfig | null {
  const trimmed = token?.trim();
  if (!trimmed || !TOKEN.test(trimmed)) return null;
  // Only PostHog Cloud's two regions. The host is never used as written, so a mistyped or
  // hostile value cannot point the proxy anywhere else.
  const region = /(^|[/.])eu\./.test(host ?? '') ? 'eu' : 'us';
  return { token: trimmed, region, ingestHost: `${region}.i.posthog.com`, assetsHost: `${region}-assets.i.posthog.com`, uiHost: `https://${region}.posthog.com` };
}

/** A link into the PostHog app, and nothing else: what a report may carry as its replay. */
export function isReplayUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 400) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^(us|eu|app)\.posthog\.com$/.test(url.hostname) && url.pathname.includes('/replay/');
  } catch {
    return false;
  }
}
