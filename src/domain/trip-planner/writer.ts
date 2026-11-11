import { MAX_PICKS } from './draft';
import type { Plan, PlanPick, PlannerPlace } from './types';

/**
 * The optional writer: the browser's built-in model may reword the draft's TITLE, INTRO, the PICK
 * notes and NEXT, one line each. It never decides facts and is never required. Everything it says
 * passes through `mergeWritten`, which keeps a line only when it is well formed, names a place the
 * draft already offered, and states nothing the planner cannot stand behind; anything else is
 * dropped and the draft's own words stay.
 */

const SYSTEM = `You write the words for a wedding website's weekend planner, in the couple's voice ("we"): warm, plain and short. No exclamation marks, no emoji.
Reply only with lines in exactly this form, nothing else:
TITLE: one specific sentence about this request, at most ten words
INTRO: one or two short sentences
PICK: <id> | one short line on why this place fits the request
NEXT: a short follow-up request in the guest's own voice
Rules: use only ids from the list. Two to five PICK lines, best first. Two or three NEXT lines. Never state opening hours, prices, times, distances or any fact that is not in the place lines. Saturday afternoon and evening are the wedding: suggest nothing for then.

Example
Request: somewhere for coffee before the wedding
Places:
bean-house | Bean House | A small roaster with a counter and a few stools.
corner-bakery | Corner Bakery | Pastries and coffee by the window.
TITLE: Coffee to start your Saturday
INTRO: Two of our favourite counters for a slow start. Leave plenty of time to get ready.
PICK: bean-house | The one we go back to.
PICK: corner-bakery | Add a pastry while you are there.
NEXT: Add a walk after coffee
NEXT: Where should we get dinner?`;

/** The format lines' own descriptions: a small model sometimes copies them back as its answer. */
const TEMPLATE = SYSTEM.split('\nRules:')[0]!
  .split('\n')
  .map((l) => /^(?:TITLE|INTRO|NEXT): (.+)$|^PICK: <id> \| (.+)$/.exec(l))
  .flatMap((m) => (m ? [(m[1] ?? m[2])!.toLowerCase().slice(0, 24)] : []));

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The writer sees only the draft's candidates (at most twelve), so its prompt stays small. */
export function writerPrompt(args: { request: string; draft: Plan; places: PlannerPlace[] }): { system: string; prompt: string } {
  const { request, draft, places } = args;
  const byId = new Map(places.map((p) => [p.id, p]));
  const ids = [...new Set([...draft.picks.map((p) => p.id), ...(draft.candidates ?? [])])].filter((id) => byId.has(id)).slice(0, 12);
  const lines = ids.map((id) => {
    const p = byId.get(id)!;
    return [p.id, p.name, clip(oneLine(p.what), 140), p.why ? `Why it matters to us: ${clip(oneLine(p.why), 110)}` : ''].filter(Boolean).join(' | ');
  });
  const draftLines = [
    `TITLE: ${draft.title}`,
    `INTRO: ${draft.intro}`,
    ...draft.picks.map((p) => `PICK: ${p.id}${p.note ? ` | ${p.note}` : ''}`),
    ...draft.next.map((n) => `NEXT: ${n}`),
  ];
  const prompt = [
    `Request: ${clip(oneLine(request), 300)}`,
    lines.length ? `Places:\n${lines.join('\n')}` : 'Places: none',
    `Our draft (improve the words; keep the same kind of answer):\n${draftLines.join('\n')}`,
  ].join('\n');
  return { system: SYSTEM, prompt };
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

const LINE = /^\s*(?:[-*•>]+|\d+[.)])?\s*[*_`]*\s*(TITLE|INTRO|PICK|NEXT)\s*[*_`]*\s*[:：]\s*[*_`]*\s*(.*)$/i;
/** Words a guest must never read on this page, and the shapes of facts the planner cannot vouch for. */
const OFF_LIMITS = /\b(ai|a\.i\.|model|language model|assistant|chatbot|openui|claude|gemini|gpt|prompt)\b/i;
const UNVOUCHED = /\d|\$|£|€|\b(minutes?|mins?|hours?|hrs?|miles?|km|kilometers?|blocks? away|o'?clock|a\.?m\.?|p\.?m\.?|open(s|ing)? (at|until|daily|late)|closes?|closed|admission|tickets? (cost|are)|reservations? (are|is) required)\b/i;
/** Saturday afternoon and evening are the wedding: a line that sends guests anywhere then is dropped. */
const WEDDING_TIME = /\btonight\b|\bsat(?:urday)?(?:['’]s)?\s+(?:afternoon|evening|night)\b|\b(?:afternoon|evening|night)\s+(?:on|of)\s+sat(?:urday)?\b/i;
const EMOJI = /\p{Extended_Pictographic}|\u{FE0F}/gu;

/** A written value made safe to show, or null when it should be ignored. */
function clean(raw: string, max: number): string | null {
  let s = raw
    .replace(EMOJI, '')
    .replace(/[*_`#]+/g, '')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/!+/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
  if (!s || s.length < 2) return null;
  if (/[<>{}[\]]/.test(s) || /^(\.\.\.|…)$/.test(s)) return null; // the template echoed back
  if (OFF_LIMITS.test(s)) return null;
  if (TEMPLATE.some((t) => s.toLowerCase().startsWith(t))) return null;
  if (s.length > max) s = clip(s, max);
  return s;
}

/**
 * Merges the writer's streamed lines into the draft. Only complete lines are read while text is
 * still arriving; pass `complete: true` once the stream has ended so the last line counts too.
 * Unknown ids, extra prose, markdown, repeats and unfinished lines are ignored; whatever is
 * missing keeps the draft's value. A PICK can only reorder or annotate ids the draft offered.
 */
export function mergeWritten(draft: Plan, streamedText: string, places: PlannerPlace[], opts: { complete?: boolean } = {}): Plan {
  const text = typeof streamedText === 'string' ? streamedText.replace(/\r\n?/g, '\n') : '';
  const all = text.split('\n');
  const lines = opts.complete ? all : all.slice(0, -1);
  const known = new Set(places.map((p) => p.id));
  const allowed = new Set([...draft.picks.map((p) => p.id), ...(draft.candidates ?? [])].filter((id) => known.has(id)));

  let title: string | null = null;
  let intro: string | null = null;
  const picks: PlanPick[] = [];
  const next: string[] = [];
  for (const line of lines) {
    const m = LINE.exec(line);
    if (!m) continue;
    const key = m[1]!.toUpperCase();
    const value = m[2] ?? '';
    if (key === 'TITLE' && title === null) title = UNVOUCHED.test(value) || WEDDING_TIME.test(value) ? null : clean(value, 90);
    else if (key === 'INTRO' && intro === null) intro = UNVOUCHED.test(value) || WEDDING_TIME.test(value) ? null : clean(value, 280);
    else if (key === 'NEXT' && next.length < 3) {
      const n = clean(value, 70);
      if (n && !next.some((x) => x.toLowerCase() === n.toLowerCase())) next.push(n);
    } else if (key === 'PICK') {
      const [rawId = '', ...rest] = value.split(/\s*[|｜]\s*/);
      const id = rawId.replace(/[`*_<>"'\s]/g, '');
      if (!allowed.has(id) || picks.some((p) => p.id === id)) continue;
      const noteRaw = rest.join(' ');
      const note = noteRaw && !UNVOUCHED.test(noteRaw) && !WEDDING_TIME.test(noteRaw) ? clean(noteRaw, 140) : null;
      picks.push(note ? { id, note } : { id });
    }
  }

  const merged: Plan = { ...draft, picks: draft.picks.map((p) => ({ ...p })), next: [...draft.next] };
  // An itinerary's title and intro are the couple's own words, and "not on our list" must say exactly that.
  const fixed = new Set(draft.fixed ?? []);
  if (title && !fixed.has('title')) merged.title = title;
  if (intro && !fixed.has('intro')) merged.intro = intro;
  if (next.length && draft.next.length) {
    merged.next = [...next, ...draft.next.filter((d) => !next.some((n) => n.toLowerCase() === d.toLowerCase()))].slice(0, 3);
  }

  // An itinerary's stops keep the couple's order, and its extras stay after them.
  const reorderable = (draft.shape === 'picks' || draft.shape === 'route') && !draft.itinerary;
  if (reorderable && picks.length >= 2) {
    const anchor = draft.picks[0];
    merged.picks = picks.slice(0, MAX_PICKS).map((w) => {
      const before = draft.picks.find((p) => p.id === w.id);
      const slot = before ? { day: before.day, part: before.part } : { day: anchor?.day, part: anchor?.part };
      const note = w.note ?? (draft.shape === 'route' ? undefined : before?.note);
      return { id: w.id, ...(slot.day ? { day: slot.day } : {}), ...(slot.part ? { part: slot.part } : {}), ...(note ? { note } : {}) };
    });
  } else if (draft.shape !== 'budget') {
    // Notes only: the answer's structure (groups, slots, rows) stays the draft's.
    for (const w of picks) {
      const target = merged.picks.find((p) => p.id === w.id);
      if (target && w.note) target.note = w.note;
    }
  }
  return merged;
}
