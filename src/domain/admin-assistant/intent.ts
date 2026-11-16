import { LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';
import { isViewName, type ViewName } from './catalog';
import type { Intent } from './types';

/**
 * What an administrator's message is asking for, read without a model.
 *
 * Each view has the words that point at it; the view with the most points wins, and a message that
 * points at nothing scores 0 — the browser's model, where there is one, is then asked to choose
 * (./writer.ts), and without one the answer is the list of things that can be asked. The router
 * never guesses a fact: it only decides which records to read.
 */

type Cue = { view: ViewName; any: RegExp; weight?: number };

const CUES: Cue[] = [
  { view: 'attention', any: /\b(attention|to-?do|todo|needs? (me|my|a decision|doing)|what('s| is) (next|left|outstanding|pending for me)|should i (do|look)|plan|checklist|prepare|ready (to|for)|before (we|i)|priorit|status|overview|summary|how (are|is) (we|things|the site) doing)\b/i },
  { view: 'traffic', any: /\b(traffic|visits?|visitors?|page ?views?|views|busiest|popular|most (viewed|visited|opened)|top pages?|devices?|browsers?|phones?|mobile|desktop|analytics|page speed|web vitals|lcp|cls|inp|load(ing)? time|how fast)\b/i },
  { view: 'sessions', any: /\b(sessions?|who (visited|came|was on|has been on|looked|opened|signed in|logged in)|logged|log of visits|recent visitors|user journeys?)\b/i, weight: 3 },
  { view: 'errors', any: /\b(errors?|bugs?|crash(es|ed)?|broke|broken|exceptions?|fail(ed|ing|ures?)? (page|pages|for guests|loads?)|went wrong|problems? (guests|visitors|people|users) (hit|had|saw|encountered)|not working)\b/i, weight: 3 },
  { view: 'pending', any: /\b(who (has ?n[o']t|have ?n[o']t|did ?n[o']t|is yet to|still (has|needs) to) (replied|responded|rsvp'?d|answered)|not (yet )?(replied|responded|rsvp'?d|answered)|still (needs?|has|have) to (reply|respond|rsvp|answer)|yet to (reply|respond|rsvp|answer)|no answer|outstanding (rsvps?|replies)|missing (rsvps?|replies)|chase|remind)\b/i, weight: 4 },
  { view: 'rsvp', any: /\b(rsvps?|repl(y|ies|ied)|respon(se|ses|ded)|coming|attending|declin(ed|es)|head ?count|accepted|how many (guests|people) (are|have))\b/i, weight: 2 },
  { view: 'lifecycle', any: /\b(lifecycle|publish(ed|ing)?|site state|what (do|can) guests see|go live|launch|open (the )?(rsvps?|invitations)|close (the )?rsvps?|save[- ]the[- ]dates?|teaser|wedding (week|day)|archive|move (the site )?to|switch (the site )?to)\b/i, weight: 2 },
  { view: 'jobs', any: /\b(jobs?|queue|queued|background (work|tasks?)|retry|retries|stuck|dead (jobs?|letters?)|emails? (sent|sending|queued))\b/i, weight: 2 },
  { view: 'metrics', any: /\b(metrics?|slow(est)?|latency|timings?|p95|p50|percentiles?|duration|performance of|counters?|histograms?|sign-?ins?|concierge answers?|capabilit(y|ies))\b/i, weight: 2 },
  { view: 'activity', any: /\b(audit|activity|what (changed|happened)|who (changed|did|edited|deleted|published)|recent (changes|actions)|history|denied|refus(ed|als?)|unauthori[sz]ed|forbidden)\b/i, weight: 2 },
  { view: 'open', any: /\b(where (do|can|is|are)|how do i (edit|change|add|update|set|remove|delete)|take me to|go to|open the|edit|change|update|add (a|an|the)|delete|remove|set up|configure|manage)\b/i },
  { view: 'help', any: /\b(help|what can (you|i) (do|ask)|how does this work|examples?|capabilities)\b/i },
  { view: 'guest', any: /\b(guest|household|invitee|person)\b/i },
];

const WINDOW_CUES: { hours: number; any: RegExp }[] = [
  { hours: 24, any: /\b(today|last (24|twenty[- ]four) hours?|24 ?h|past day|last day|since yesterday|yesterday|tonight|this (morning|afternoon|evening))\b/i },
  { hours: 720, any: /\b(month|30 days?|30 ?d|four weeks|4 weeks)\b/i },
  { hours: 168, any: /\b(week|7 days?|7 ?d|seven days)\b/i },
];

const STATE_CUES: { state: LifecycleState; any: RegExp }[] = [
  { state: 'RSVP_CLOSED', any: /\b(close (the )?rsvps?|rsvps? closed|rsvp[_ ]closed)\b/i },
  { state: 'RSVP_OPEN', any: /\b(open (the )?rsvps?|rsvps? open|rsvp[_ ]open)\b/i },
  { state: 'SAVE_THE_DATE', any: /\bsave[-_ ]the[-_ ]dates?\b/i },
  { state: 'INVITATIONS_OPEN', any: /\b(open (the )?invitations|invitations?[_ ](open|out)|send (the )?invitations)\b/i },
  { state: 'WEDDING_WEEK', any: /\bwedding[_ ]week\b/i },
  { state: 'WEDDING_DAY', any: /\bwedding[_ ]day\b/i },
  { state: 'POST_WEDDING', any: /\b(post[-_ ]wedding|after the wedding)\b/i },
  { state: 'ARCHIVE', any: /\barchive\b/i },
  { state: 'TEASER', any: /\bteaser\b/i },
];

/** A session id as the telemetry tables write it. */
const SESSION_ID = /\b(?:session\s+)?([A-Za-z0-9_-]{16,40})\b/;

const STOP = new Set(
  'a about all an and any are as at be been by can did do does done for from had has have how i in is it last list me my of on or our please show site tell that the their them this to up us was we week what when where which who why with you today yesterday month visits visit visited session sessions has not replied guest guests household done seen opened looked page pages errors error on'.split(' '),
);

/** What is left of a message once the question's own words are gone: a name, usually. */
export function subjectOf(message: string): string {
  const quoted = /["“']([^"”']{2,60})["”']/.exec(message);
  if (quoted?.[1]) return quoted[1].trim();
  return message
    .replace(/[?.!,;:()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()))
    .join(' ')
    .trim()
    .slice(0, 60);
}

const windowOf = (message: string) => WINDOW_CUES.find((w) => w.any.test(message))?.hours;
const stateOf = (message: string) => {
  const exact = LIFECYCLE_STATES.find((s) => new RegExp(`\\b${s}\\b`).test(message));
  return exact ?? STATE_CUES.find((s) => s.any.test(message))?.state;
};

/**
 * Read a message. `known` is what the caller already has from the page (a model's choice, a
 * follow-up button's arguments) and wins over anything read from the words.
 */
export function route(message: string, known: Partial<Intent> = {}): Intent {
  const text = message.trim();
  const scores = new Map<ViewName, number>();
  for (const cue of CUES) if (cue.any.test(text)) scores.set(cue.view, (scores.get(cue.view) ?? 0) + (cue.weight ?? 1));

  const window = known.window ?? windowOf(text);
  const state = known.state ?? stateOf(text);
  const sessionId = known.sessionId ?? (/\bsession\b/i.test(text) ? SESSION_ID.exec(text)?.[1] : undefined);
  const withErrors = known.withErrors ?? (scores.has('sessions') && scores.has('errors') ? true : undefined);
  const denied = known.denied ?? (/\b(denied|refus|unauthori[sz]ed|forbidden)/i.test(text) ? true : undefined);

  // Sessions that hit errors are a list of sessions, not the error groups.
  if (withErrors && /\b(sessions?|who)\b/i.test(text)) scores.set('sessions', (scores.get('sessions') ?? 0) + 3);
  // A verb that changes the lifecycle is about the lifecycle even when "RSVP" also names the replies.
  if (state && /\b(open|close|publish|move|switch|go live|launch|send)\b/i.test(text)) scores.set('lifecycle', (scores.get('lifecycle') ?? 0) + 4);
  if (sessionId) scores.set('session', 6);
  // "What should I do before we open RSVPs" is a request for the checklist, which carries the change as a proposal.
  if (/\b(what should (i|we)|what do (i|we) need|before (we|i)|plan|checklist|prepare|get ready)\b/i.test(text)) scores.set('attention', (scores.get('attention') ?? 0) + 6);
  // "What has Ada done", "did the Testhouses visit": a name with a visiting verb is one guest.
  if (/\b(did|has|have)\b.*\b(visit(ed)?|done|seen|opened|looked|been on|signed in|logged in|replied)\b/i.test(text) && /[A-Z][a-z]+/.test(text.slice(1))) scores.set('guest', (scores.get('guest') ?? 0) + 3);

  let view: ViewName | undefined = isViewName(known.view) ? known.view : undefined;
  let confidence = view ? 9 : 0;
  if (!view) {
    for (const [name, points] of scores) {
      if (points > confidence) {
        view = name;
        confidence = points;
      }
    }
  }
  const subject = known.subject ?? (view === 'guest' || view === 'open' || !view ? subjectOf(text) : undefined);
  return {
    view: view ?? 'help',
    confidence,
    ...(window ? { window } : {}),
    ...(state ? { state } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(withErrors ? { withErrors } : {}),
    ...(denied ? { denied } : {}),
    ...(subject ? { subject } : {}),
  };
}
