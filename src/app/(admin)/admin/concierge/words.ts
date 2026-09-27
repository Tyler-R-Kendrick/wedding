/*
 * The concierge log's stored codes, in words. The trace rows and the audit trail keep the codes
 * (`ai.security_alert` rules, verifier verdicts, router intents, invocation outcomes); the page says
 * what they mean. A code nobody has written words for yet reads as itself with the dots, dashes and
 * underscores taken out ("model-rejected" → "Model rejected"), never as a raw token.
 */

/** "model-rejected", "user_message", "venue.history" → "Model rejected", "User message", "Venue history". */
export function humanise(code: string): string {
  const words = code.replace(/[-_.:]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/** A phrase as the start of a sentence or a table cell. */
export function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function lookup(table: Record<string, string>, code: string | null | undefined): string {
  if (code === null || code === undefined || code === '') return '';
  return table[code] ?? humanise(code);
}

/**
 * A comma-separated list of codes (how the audit trail stores rules and reasons), each in words, as
 * phrases that continue a sentence ("Dropped because …"): an unknown one is humanised in lower case.
 */
function list(table: Record<string, string>, codes: unknown): string {
  const items = Array.isArray(codes) ? codes.map(String) : String(codes ?? '').split(',');
  return items
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => table[c] ?? humanise(c).toLowerCase())
    .join('; ');
}

/** Why the verifier dropped a sentence (`Verdict` in ai/verifier.ts). */
const REASON: Record<string, string> = {
  uncited: 'it cited no source',
  'unknown-marker': 'it cited a source that was not given',
  'untrusted-only': 'its only sources were not trusted',
  unsupported: 'its source did not say it',
  'off-topic': 'its source was about something else',
  'model-rejected': 'the checking model rejected it',
};

/** Which prompt-injection rule matched (`RULES` in ai/injection.ts). */
const RULE: Record<string, string> = {
  'ignore-instructions': 'told it to ignore its instructions',
  'new-instructions': 'claimed to bring new instructions',
  'role-override': 'tried to change its role',
  'system-marker': 'posed as a system message',
  'authority-claim': 'claimed authority to give orders',
  exfiltration: 'asked for secrets or its instructions',
  'broadcast-fact': 'asked it to announce a fact to every guest',
  'do-not-cite': 'told it not to cite its sources',
  'assistant-address': 'addressed the assistant with orders',
};

/** Where the injection attempt was found (the alert's `kind`). */
const WHERE: Record<string, string> = {
  user_message: 'In the question',
  source: 'In a source it read',
};

/** What the question was about (router intents in ai/router.ts). */
const INTENT: Record<string, string> = {
  'wedding.when': 'When the wedding is',
  'wedding.where': 'Where the wedding is',
  'wedding.protected:room': 'Which room (not decided yet)',
  'wedding.protected:time': 'What time (not decided yet)',
  'venue.history': 'The venue’s history',
  'venue.space': 'A space at the venue',
  'venue.outlets': 'Places to eat and drink at the venue',
  story: 'Our story',
  adventures: 'Our adventures',
  guide: 'Things to do',
  faq: 'A common question',
  personal: 'The guest’s own invitation',
  generic: 'Something else',
  search: 'A search of the site',
};

/** How a capability call ended (`AI_INVOCATION_OUTCOMES`). */
const OUTCOME: Record<string, string> = {
  success: 'Answered',
  denied: 'Not allowed',
  failed: 'Failed',
  confirmation_required: 'Needs the guest to confirm',
};

/** What kind of capability it was (`CapabilityKind`). */
const KIND: Record<string, string> = {
  read: 'Read',
  navigate: 'Link to a page',
  draft: 'Draft',
  action: 'Change',
  transaction: 'Booking or claim',
  external: 'Outside service',
};

/** Who chose to call it (`AiToolSelector`). */
const SELECTED_BY: Record<string, string> = { router: 'The router', model: 'The model' };

/** Why a call did not succeed (`CapabilityErrorCode`). */
const ERROR: Record<string, string> = {
  unauthenticated: 'Not signed in',
  forbidden: 'Not allowed',
  step_up_required: 'Needed a fresh sign-in',
  confirmation_required: 'Needed confirmation',
  validation: 'The request was not valid',
  not_found: 'Not found',
  conflict: 'Conflicted with a change',
  rate_limited: 'Too many requests',
  feature_disabled: 'Switched off',
  provider_unavailable: 'Provider unavailable',
  provider_error: 'Provider error',
  stale_data: 'Data out of date',
  internal: 'Internal error',
};

export const reasonWords = (codes: unknown) => list(REASON, codes);
export const ruleWords = (codes: unknown) => list(RULE, codes);
export const whereWords = (code: unknown) => lookup(WHERE, code === undefined || code === null ? 'source' : String(code));
export const intentWords = (code: unknown) => lookup(INTENT, code === undefined || code === null ? '' : String(code));
export const outcomeWords = (code: string) => lookup(OUTCOME, code);
export const kindWords = (code: string) => lookup(KIND, code);
export const selectedByWords = (code: string) => lookup(SELECTED_BY, code);
export const errorWords = (code: string | null) => lookup(ERROR, code);
