import type { PostHog } from 'posthog-node';
import { observeConfig } from './config';

/**
 * The server's side of session tracing: a failure Next reports (`onRequestError`) is sent to
 * PostHog as an exception, joined to the visitor's session when the request carried its id.
 *
 * One client per process, created on the first failure and never before: a server that never
 * fails loads none of this. Each exception is sent at once, because a serverless function may be
 * frozen the moment its response is written.
 */
const g = globalThis as unknown as { __weddingPostHog?: PostHog | null };

async function client(): Promise<PostHog | null> {
  if (g.__weddingPostHog !== undefined) return g.__weddingPostHog;
  const config = observeConfig();
  if (!config) return (g.__weddingPostHog = null);
  const { PostHog: Client } = await import('posthog-node');
  return (g.__weddingPostHog = new Client(config.token, { host: `https://${config.ingestHost}`, flushAt: 1, flushInterval: 0, disableGeoip: true }));
}

const header = (headers: Record<string, string | string[] | undefined>, name: string): string | undefined => {
  const value = headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first && /^[A-Za-z0-9_-]{8,100}$/.test(first) ? first : undefined;
};

/** Never throws, never waits more than a moment: the request it reports on has already failed. */
export async function sendServerException(error: unknown, headers: Record<string, string | string[] | undefined>, properties: Record<string, unknown>): Promise<void> {
  try {
    const posthog = await client();
    if (!posthog) return;
    // The ids posthog-js adds to same-origin requests (`tracing_headers`). Without them this is a
    // failure with no visitor behind it: a cron run, a crawler, a browser that blocks the SDK.
    const session = header(headers, 'x-posthog-session-id');
    const distinct = header(headers, 'x-posthog-distinct-id') ?? `server-${crypto.randomUUID()}`;
    const sending = posthog.captureExceptionImmediate(error, distinct, { ...properties, $process_person_profile: false, ...(session ? { $session_id: session } : {}) });
    await Promise.race([sending, new Promise((resolve) => setTimeout(resolve, 2_000).unref?.())]);
  } catch {
    // PostHog being unreachable is not this request's problem.
  }
}

/**
 * One named event from the server, sent at once. Used for the couple's problem reports
 * (src/lib/feedback/deliver.ts), which are recorded here so that a report always has a durable,
 * queryable copy even when no issue tracker could take it. Returns whether it was sent.
 */
export async function sendServerEvent(event: string, distinctId: string, properties: Record<string, unknown>): Promise<boolean> {
  try {
    const posthog = await client();
    if (!posthog) return false;
    const sending = posthog.captureImmediate({ distinctId, event, properties: { ...properties, $process_person_profile: false } }).then(
      () => true,
      () => false,
    );
    return await Promise.race([sending, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000).unref?.())]);
  } catch {
    return false;
  }
}
