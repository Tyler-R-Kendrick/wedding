import { z } from 'zod';
import type { AnyCapability } from '@/contracts/capability';
import type { FlagValues } from '@/contracts/flags';
import type { Principal } from '@/contracts/principal';
import { INTERNAL_ROUTES, isInternalRoute } from '@/capabilities/routes';
import { registry } from '@/capabilities/registry';
import { contentTokens, stem, stemmedSet } from './text';

/**
 * Deterministic capability router (ADR-0002 rule 2, ADR-0003 rule 1).
 *
 * The tool list is DERIVED from the registry: only descriptors with `exposure.ai`, filtered by flag
 * and by what the principal may call. Omission is UX minimisation; `invoke` re-checks everything.
 * For each question the router (not the model) decides which capabilities run: named intent rules
 * for the capabilities this repo knows, and description-overlap scoring for any capability another
 * swarm registers later (flights, hotels, seating, RSVP drafts…). The model formats what came back;
 * it never recalls.
 */
export type ProtectedFact = 'room' | 'time' | 'dress' | 'menu' | 'music';

export interface PlannedCall {
  name: string;
  input: unknown;
  reason: string;
}

export interface RoutePlan {
  intent: string;
  protectedFact?: ProtectedFact;
  calls: PlannedCall[];
  /** AI-exposed capabilities that matched but the principal may not call (sign-in / entitlement). */
  denied: string[];
  /** Matched capabilities skipped because a required input could not be built from the question. */
  needsDetails: string[];
  navigate?: { route: string; highlight?: string };
  /** True when a live/external tool was selected: the answer must be timestamped. */
  live: boolean;
  /** True when the question is about the caller's own data (table, RSVP, invitation). */
  personal: boolean;
}

export interface RouterTool {
  descriptor: AnyCapability;
  jsonSchema: Record<string, unknown>;
}

/** Capabilities the model may see: `exposure.ai`, flag on, and callable by this principal. */
export function toolsFor(principal: Principal, flags: FlagValues, reg = registry): RouterTool[] {
  return reg.list({ exposure: 'ai', principal, flags }).map((descriptor) => ({ descriptor, jsonSchema: inputJsonSchema(descriptor) }));
}

/** Everything AI-exposed regardless of principal (to explain denials without ever calling them). */
export function allAiTools(flags: FlagValues, reg = registry): AnyCapability[] {
  return reg.list({ exposure: 'ai', flags });
}

export function inputJsonSchema(descriptor: AnyCapability): Record<string, unknown> {
  try {
    return z.toJSONSchema(descriptor.input, { unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

/** Names the router never plans on its own (they are the pipeline itself or navigation). */
const NEVER_AUTO = new Set(['ask_concierge', 'search_wedding_information', 'search_wedding_information_static', 'navigate_to']);

const ROOM_SLUGS: [RegExp, string][] = [
  [/white\s*city/i, 'white-city-ballroom'],
  [/madison\s*ballroom/i, 'madison-ballroom'],
  [/stagg/i, 'stagg-court'],
  [/\bthe\s+tank\b|\btank\b/i, 'the-tank'],
];

const ROUTE_WORDS: [RegExp, string][] = [
  [/rsvp/i, '/rsvp'],
  [/travel|stay|hotel|airport|flight/i, '/travel'],
  [/transport|shuttle|ride|uber|parking|valet/i, '/transportation'],
  [/gift|registry/i, '/gifts'],
  [/photo|video|gallery/i, '/photos'],
  [/story|met|meet/i, '/our-story'],
  [/adventure|memor/i, '/our-adventures'],
  [/recommend|itinerar|things to do|share an adventure/i, '/share-an-adventure'],
  [/caa|athletic|venue|building|hotel/i, '/explore-caa'],
  [/wedding|ceremony|reception|schedule|when|where/i, '/the-wedding'],
  [/weekend|my weekend/i, '/your-weekend'],
  [/faq|question|ask/i, '/ask-us'],
];

const PROTECTED: [RegExp, ProtectedFact][] = [
  [/(which|what)\s+(room|space|ballroom|hall)|(ceremony|reception|cocktail\s*hour|wedding)[^.?]{0,40}\b(room|space|held|take place|happen|located|where)\b|\bwhere\b[^.?]{0,30}\b(ceremony|reception|cocktail\s*hour)\b/i, 'room'],
  [/(what|which)\s+time|start time|\bstarts?\b|\bbegins?\b|o'?clock|\bschedule\b|\btimeline\b|how long|end time|\bends?\b/i, 'time'],
  [/dress\s*code|what (should|do|can|to) (i|we) wear|\battire\b|black[- ]tie|cocktail attire|formal|\bsuit\b|\bgown\b|\bheels\b/i, 'dress'],
  [/\bmenu\b|what('s| is) (for )?(dinner|lunch|food)|\bvegan\b|\bvegetarian\b|gluten|\bcater/i, 'menu'],
  [/\bmusic\b|\bband\b|\bdj\b|playlist|first dance|song/i, 'music'],
];

interface Rule {
  intent: string;
  pattern: RegExp;
  calls: (q: string) => PlannedCall[];
  personal?: boolean;
}

const RULES: Rule[] = [
  { intent: 'wedding.when', pattern: /\bwhen\b|what (day|date|year)|\bdate\b|time ?zone|what stage|how many days|countdown/i, calls: () => [{ name: 'site_status', input: {}, reason: 'date/venue facts' }] },
  {
    intent: 'wedding.where',
    pattern: /\bwhere\b|\bvenue\b|\baddress\b|\blocation\b|how (do i|to|can i) get|directions|\bparking\b|\bvalet\b|\btransit\b|\btrain\b|\bcta\b|\bdrive\b|\bwalk(ing)?\b|\bbus\b|\bmetra\b/i,
    calls: () => [
      { name: 'site_status', input: {}, reason: 'venue address' },
      { name: 'get_venue_facts', input: {}, reason: 'getting here / operational records' },
    ],
  },
  { intent: 'venue.history', pattern: /\bbuilt\b|architect|\bhistor|\b1893\b|\bgothic\b|\bbuilding\b|landmark|\bcobb\b|\bmullgardt\b|athletic association|stained glass|marble|\bclub\b|\brestor|columbian|look for/i, calls: () => [{ name: 'get_venue_facts', input: {}, reason: 'venue docent' }] },
  { intent: 'venue.space', pattern: /white\s*city|madison\s*ballroom|stagg|\bthe\s+tank\b|ballroom|gymnasium|swimming pool|basketball/i, calls: (q) => ROOM_SLUGS.filter(([re]) => re.test(q)).map(([, slug]) => ({ name: 'show_venue_room', input: { slug }, reason: 'named space' })) },
  { intent: 'venue.outlets', pattern: /cindy|rooftop|\bbar\b|restaurant|\bdrinks?\b|coffee|breakfast|shake shack|game room|drawing room|milk room|cherry circle|\beat\b|dining|\bhours\b|midosuji|midōsuji|fairgrounds|the ives|topgolf|amenit/i, calls: () => [{ name: 'get_venue_facts', input: {}, reason: 'outlets and amenities' }] },
  { intent: 'story', pattern: /how (did|do) (you|they|sara|tyler|the couple)( two| both)? meet|\bmet\b|\bstory\b|propos|engage|first .{0,20}love|love story|relationship|together/i, calls: () => [{ name: 'get_story', input: {}, reason: 'authored story' }] },
  {
    intent: 'adventures',
    pattern: /adventure|memor|starved rock|museum of ice cream|richardson|steakhouse|madison waterfront|garden/i,
    calls: (q) => [{ name: 'list_adventures', input: {}, reason: 'adventure memories' }, ...(/starved rock/i.test(q) ? [{ name: 'show_adventure', input: { slug: 'starved-rock' }, reason: 'named memory' }] : [])],
  },
  {
    intent: 'guide',
    pattern: /recommend|things to do|what to do|to do\b|\bvisit\b|explore|itinerar|\bplan\b|with kids|\bkids?\b|children|family|architecture|food|\bhours? (free|to spare|to kill)\b|\bweekend\b|friday|saturday morning|nearby|around the hotel|neighbou?rhood|day trip/i,
    calls: (q) => {
      const kids = /\bkids?\b|children|family/i.test(q) ? { kids: true } : {};
      const minutes = q.match(/(\d+)\s*(hours?|hrs?|h)\b/i);
      const maxMinutes = minutes ? Math.min(720, Math.max(15, Number(minutes[1]) * 60)) : /45\s*min/i.test(q) ? 45 : undefined;
      return [
        { name: 'find_adventures', input: { query: q.slice(0, 120), ...kids, ...(maxMinutes ? { maxMinutes } : {}) }, reason: 'recommendations' },
        { name: 'list_itineraries', input: {}, reason: 'curated itineraries' },
      ];
    },
  },
  {
    intent: 'faq',
    pattern: /\bkids?\b|child|plus.?one|\bguest\b|bring|weather|rain|photo|camera|accessib|wheelchair|rsvp|contact|reach you|gift|registry|hotel|room block|\bstay\b|travel|airport|flight|dress|wear|what time|start/i,
    calls: () => [{ name: 'get_faq', input: {}, reason: 'frequently asked' }],
  },
  {
    intent: 'personal',
    pattern: /\bmy\b[^.?]{0,20}\b(table|seat|seating|rsvp|invitation|invite|household|plus.?one|meal|benefit|voucher|ride)\b|\bam i\b|\bour (table|seats?|rsvp|invitation)\b|where (am i|are we) (sitting|seated)|which table/i,
    calls: () => [],
    personal: true,
  },
];

function slugInput(schema: Record<string, unknown>, q: string): unknown | undefined {
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  const required = (schema.required ?? []) as string[];
  const input: Record<string, unknown> = {};
  for (const key of required) {
    if (key === 'query' || key === 'q' || key === 'question' || key === 'text') input[key] = q.slice(0, 120);
    else if (key === 'slug') {
      const slug = ROOM_SLUGS.find(([re]) => re.test(q))?.[1] ?? (/starved rock/i.test(q) ? 'starved-rock' : undefined);
      if (!slug) return undefined;
      input[key] = slug;
    } else return undefined;
  }
  if ('query' in props && !('query' in input)) input.query = q.slice(0, 120);
  return input;
}

/** Description-overlap score for capabilities without a named rule. */
export function descriptionScore(descriptor: Pick<AnyCapability, 'name' | 'title' | 'description'>, question: string): number {
  const q = new Set(contentTokens(question).map(stem));
  if (q.size === 0) return 0;
  const nameTokens = stemmedSet(descriptor.name.split('_'));
  const titleTokens = stemmedSet(contentTokens(descriptor.title));
  const descTokens = stemmedSet(contentTokens(descriptor.description));
  let score = 0;
  for (const t of q) {
    if (nameTokens.has(t)) score += 3;
    else if (titleTokens.has(t)) score += 2;
    else if (descTokens.has(t)) score += 1;
  }
  return score;
}

export const GENERIC_SELECT_THRESHOLD = 4;

export function planRoute(question: string, available: readonly RouterTool[], everything: readonly AnyCapability[], maxCalls: number): RoutePlan {
  const q = question.trim();
  const byName = new Map(available.map((t) => [t.descriptor.name, t]));
  const allNames = new Set(everything.map((c) => c.name));
  const calls: PlannedCall[] = [];
  const denied = new Set<string>();
  const needsDetails = new Set<string>();
  const intents: string[] = [];
  let personal = false;

  const add = (call: PlannedCall) => {
    if (!allNames.has(call.name)) return;
    if (!byName.has(call.name)) {
      denied.add(call.name);
      return;
    }
    if (calls.some((c) => c.name === call.name)) return;
    if (calls.length < maxCalls) calls.push(call);
  };

  for (const rule of RULES) {
    if (!rule.pattern.test(q)) continue;
    intents.push(rule.intent);
    if (rule.personal) personal = true;
    for (const call of rule.calls(q)) add(call);
  }

  const protectedFact = PROTECTED.find(([re]) => re.test(q))?.[1];
  if (protectedFact) {
    intents.unshift(`wedding.protected:${protectedFact}`);
    add({ name: 'get_faq', input: {}, reason: 'protected wedding fact: FAQ placeholders say what is undecided' });
    if (protectedFact === 'room') add({ name: 'get_venue_facts', input: {}, reason: 'rooms not confirmed' });
    if (protectedFact === 'time') add({ name: 'site_status', input: {}, reason: 'date is known; times are not' });
  }

  // Generic selection for capabilities other swarms register (seating, RSVP drafts, live travel…).
  const scored = everything
    .filter((c) => !NEVER_AUTO.has(c.name) && !RULES.some((r) => r.calls(q).some((x) => x.name === c.name)))
    .map((c) => ({ c, score: descriptionScore(c, q) }))
    .filter((x) => x.score >= GENERIC_SELECT_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  for (const { c } of scored) {
    if (!byName.has(c.name)) {
      denied.add(c.name);
      continue;
    }
    const tool = byName.get(c.name)!;
    const input = slugInput(tool.jsonSchema, q);
    if (input === undefined) {
      needsDetails.add(c.name);
      continue;
    }
    add({ name: c.name, input, reason: 'description match' });
  }
  if (personal) {
    for (const c of everything) {
      if (/seat|table|rsvp|household|invitation|my_|benefit|voucher/.test(c.name) && !NEVER_AUTO.has(c.name) && (c.kind === 'read' || c.kind === 'draft')) {
        if (!byName.has(c.name)) denied.add(c.name);
        else if (!calls.some((x) => x.name === c.name)) {
          const input = slugInput(byName.get(c.name)!.jsonSchema, q);
          if (input === undefined) needsDetails.add(c.name);
          else add({ name: c.name, input, reason: 'own data' });
        }
      }
    }
  }

  let navigate: RoutePlan['navigate'];
  if (/^(where can i find|take me to|open|go to|show me|navigate to)\b/i.test(q) && byName.has('navigate_to')) {
    const route = ROUTE_WORDS.find(([re]) => re.test(q))?.[1];
    if (route && isInternalRoute(route) && (INTERNAL_ROUTES as readonly string[]).includes(route)) navigate = { route };
  }

  const live = calls.some((c) => {
    const d = byName.get(c.name)?.descriptor;
    return d?.kind === 'external' || (d ? /flight|hotel|ride|price|rate|availability|live/.test(`${d.name} ${d.description}`.toLowerCase()) && d.annotations.untrustedContentHint : false);
  });

  return {
    intent: intents[0] ?? (calls.length ? 'generic' : 'search'),
    protectedFact,
    calls,
    denied: [...denied],
    needsDetails: [...needsDetails],
    navigate,
    live,
    personal,
  };
}
