import { observeConfig } from './config';

/**
 * What the rest of the site imports instead of `posthog-js`: `capture`, `captureException`,
 * `identify` and `reset`, with the SDK's own names and arguments.
 *
 * It exists so that using PostHog from a component does not put PostHog in that component's
 * bundle. The SDK is about 200 kB on the wire, and it is loaded once, lazily, after the page is
 * interactive (src/instrumentation-client.ts -> ./posthog-client.ts). A call made before it arrives
 * is kept, in order, and replayed when it does; a call made when PostHog is not configured is
 * dropped. Either way a call here never throws and never waits.
 *
 * One instance, too. The SDK in `./posthog-client.ts` is the build with no script loader, set up
 * with the site's masking and its same-origin proxy. A second `import posthog from 'posthog-js'`
 * elsewhere would be a different, unconfigured copy.
 */
export interface PostHogSink {
  capture(event: string, properties?: Record<string, unknown>): void;
  captureException(error: unknown, properties?: Record<string, unknown>): void;
  identify(distinctId: string, properties?: Record<string, unknown>): void;
  reset(): void;
}

type Call = { [K in keyof PostHogSink]: [K, ...Parameters<PostHogSink[K]>] }[keyof PostHogSink];

/** A page that fires more than this before the SDK loads keeps the most recent. */
const MAX_WAITING = 100;
const waiting: Call[] = [];
let sink: PostHogSink | null = null;

function apply(to: PostHogSink, call: Call): void {
  try {
    const [method, ...args] = call;
    (to[method] as (...a: unknown[]) => void)(...args);
  } catch {
    // Analytics never fails the action it describes.
  }
}

function send(call: Call): void {
  if (sink) return apply(sink, call);
  if (typeof window === 'undefined' || !observeConfig()) return;
  waiting.push(call);
  if (waiting.length > MAX_WAITING) waiting.shift();
}

/** Called once by `./posthog-client.ts` when the SDK has started: replays what was waiting. */
export function connectPostHog(next: PostHogSink): void {
  sink = next;
  for (const call of waiting.splice(0)) apply(next, call);
}

const posthog: PostHogSink = {
  capture: (event, properties) => send(['capture', event, properties]),
  captureException: (error, properties) => send(['captureException', error, properties]),
  identify: (distinctId, properties) => send(['identify', distinctId, properties]),
  reset: () => send(['reset']),
};

export default posthog;

/** Tests only. */
export function resetPostHogFacade(): void {
  sink = null;
  waiting.length = 0;
}
