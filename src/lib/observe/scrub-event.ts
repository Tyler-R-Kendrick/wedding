import { scrubPath } from '@/lib/diagnostics/scrub';

/**
 * What is taken out of every PostHog event before it leaves the browser (`before_send`). Its own
 * file, with no SDK in it, so the rule can be tested and read without loading PostHog.
 *
 * Two things:
 *  - Addresses lose their query values. An invitation token and a preview pass travel there.
 *  - The concierge's analytics event (`$ai_generation`, src/lib/ai/browser-model.ts) keeps its
 *    timing, token counts and model, and loses the guest's question, the grounding prompt and the
 *    answer. Nothing a guest types is sent to PostHog: not in a replay, where inputs and text are
 *    masked, and not here.
 */
const URL_PROPERTIES = ['$current_url', '$referrer', '$prev_pageview_pathname', '$pathname', '$initial_current_url', '$initial_referrer', '$session_entry_url', '$session_entry_referrer'];
const TYPED_CONTENT = ['$ai_input', '$ai_output_choices'];

export function scrubUrl(value: unknown, origin: string): unknown {
  if (typeof value !== 'string' || !value) return value;
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.origin}${scrubPath(url.pathname + url.search)}` : url.origin;
  } catch {
    return scrubPath(value);
  }
}

export interface OutgoingEvent {
  event?: string;
  properties?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

/** Mutates and returns the event, as `before_send` expects. */
export function scrubEvent<T extends OutgoingEvent | null>(event: T, origin: string): T {
  if (!event) return event;
  const properties = event.properties ?? {};
  for (const key of URL_PROPERTIES) if (key in properties) properties[key] = scrubUrl(properties[key], origin);
  if (event.$set_once) for (const key of URL_PROPERTIES) if (key in event.$set_once) event.$set_once[key] = scrubUrl(event.$set_once[key], origin);
  if (event.event === '$ai_generation') for (const key of TYPED_CONTENT) delete properties[key];
  return event;
}
