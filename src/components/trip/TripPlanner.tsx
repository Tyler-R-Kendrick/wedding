'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { downloadIcs, TripPlannerProvider, TripRenderer, type TripAction, type TripHotel } from '@/components/trip/openui';
import {
  aboutHowLong,
  addDays,
  clockSpan,
  dayOfDate,
  savedDate,
  slotForDate,
  slotName,
  weekendDate,
  STAY_MAX_DAYS,
  stayDays,
  wallTime,
  blockEntries,
  buildIcs,
  calendarModel,
  compose,
  dateLabel,
  draftPlan,
  isWeddingTime,
  itineraryStarter,
  knowBeforeYouGo,
  legBetween,
  PART_LENGTH,
  PART_START,
  planRoute,
  PARTS,
  planEntries,
  safeSlot,
  scheduleOf,
  stayFacts,
  staysInBlock,
  stopMinutes,
  timeText,
  tripEntries,
  weddingEntries,
  type CalendarEntry,
  type Day,
  type Diet,
  type Meal,
  type OutsidePick,
  type OutsideQuery,
  type Part,
  type Plan,
  type Prefs,
  type PlannerItinerary,
  type PlannerPlace,
  type SavedItem,
  type StayFacts,
  type TripItemInput,
  type WeddingEventInput,
} from '@/domain/trip-planner';
import { prefsOf, profileOf, profileStarters, withPrefs, type TripPrefs, type TripProfile } from '@/domain/trip-planner/profile';
import { embed, ensureLocal, getLocalModels, holdLocal } from '@/lib/ai/local';
import { speechSupport, startDictation, type Dictation, type DictationError } from '@/lib/speech';
import { Icon, type IconName } from '@/themes/shared/icons';
import { TripProfileBar } from './TripProfile';
import './trip.css';

/**
 * Your Trip's planner: the guest asks, in their own words or by speaking, and an answer built from
 * the couple's own places appears at once. Then, quietly and only on this device, it gets better:
 * the matcher re-ranks the places when it is installed, and the browser's built-in model rewords
 * the answer when there is one. Neither is required, and neither is ever named on the page.
 *
 * "My weekend" is the guest's own trip items (one per saved place), changed optimistically here and
 * saved through the server actions the page passes in. Without them (an administrator previewing)
 * the weekend lives in memory only. The server keys every save and remove on the place, and the
 * changes to one place are sent one after another, so a quick heart and un-heart, or an add and a
 * move, arrive in order and never leave a second row behind.
 */

/** A saved place as the board holds it (`itemId`: the trip item it was loaded from, for reference only). */
export type PlannerSaved = SavedItem & { name: string; itemId?: string | null };

type TabKey = 'plans' | 'things';
/** A part of one day of the stay. */
type Slot = { date: string; part: Part };

export type PlannerActions = {
  save(input: { placeId: string; day: Day; part: Part; date?: string }): Promise<{ ok: true; itemId: string } | { ok: false; message: string }>;
  remove(input: { placeId: string }): Promise<{ ok: true } | { ok: false; message: string }>;
  /** The guest's own plan ("Dinner with family"): added, or with `itemId` moved or reworded. */
  saveOwn(input: { itemId?: string; title: string; day: Day; part: Part; date?: string }): Promise<{ ok: true; itemId: string } | { ok: false; message: string }>;
  removeOwn(input: { itemId: string }): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Places near the hotel from outside our own list, for one answer. Absent: answers are ours alone. */
  searchNearby?(query: OutsideQuery, ours: string[]): Promise<{ ok: true; places: OutsidePick[] } | { ok: false }>;
  /** Saves what the guest set for the planner. `conflict`: another device saved since, and what is saved comes back instead. */
  savePrefs?(input: { prefs: TripPrefs; basedOn?: string | null }): Promise<{ ok: true; profile: TripProfile; prefs: TripPrefs | null; updatedAt: string | null; conflict: boolean } | { ok: false; message: string }>;
  /** The guest's plans and profile as they are saved now, for a page that has been open a while. */
  refresh?(): Promise<{ ok: true; saved: PlannerSaved[]; profile: TripProfile; prefs: TripPrefs | null; updatedAt: string | null } | { ok: false }>;
};

export type TripPlannerProps = {
  places: PlannerPlace[];
  saved: PlannerSaved[];
  /** The guest's flights and hotel, for the calendar. */
  bookings: TripItemInput[];
  /** The wedding's own events, for the calendar. */
  events: WeddingEventInput[];
  hotel: TripHotel | null;
  stay?: StayFacts;
  /** The couple's own itineraries (none: the planner answers from the places alone). */
  itineraries?: PlannerItinerary[];
  /** Absent: the weekend is kept in memory only. */
  actions?: PlannerActions;
  /** Who the planner plans for. Absent: one adult, nothing known. */
  profile?: TripProfile;
  /** When the guest's own answers were last saved, so a later save can tell if another device changed them. */
  prefs?: { value: TripPrefs | null; updatedAt: string | null };
};

/** One question and its answer. `waiting`: the answer is being chosen and is not shown yet; once shown it never changes. */
type Turn = { id: number; request: string; program: string; waiting: boolean };

type Starter = { label: string; hint: string; request: string; icon: IconName };

/** The starters when the couple have no itinerary for them; `key` is the kind of itinerary each stands in for. */
export const STARTERS: (Starter & { key: string })[] = [
  { key: 'saturday-morning', label: 'A free Saturday morning', hint: 'Before the wedding', request: 'A free Saturday morning before the wedding', icon: 'sunrise' },
  { key: '2-3-h', label: 'I have two hours', hint: 'Fit it to the time', request: 'I have two hours', icon: 'clock' },
  { key: 'architecture', label: 'For the architecture people', hint: 'Buildings worth the walk', request: 'For the architecture people', icon: 'landmark' },
  { key: 'with-kids', label: 'With kids', hint: 'Things they will love', request: 'Something to do with kids', icon: 'balloon' },
  { key: 'dinner', label: 'Where should we get dinner?', hint: 'In the hotel or out', request: 'Where should we get dinner?', icon: 'dinner' },
  { key: 'weekend', label: 'Plan my whole weekend', hint: 'Friday to Sunday', request: 'Plan my whole weekend', icon: 'calendar' },
];

const BUCKET_LOOK: Record<string, { hint: string; icon: IconName }> = {
  '45-min': { hint: 'Between other things', icon: 'clock' },
  '2-3-h': { hint: 'Fit it to the time', icon: 'clock' },
  'friday-afternoon': { hint: 'If you arrive early', icon: 'sun' },
  'saturday-morning': { hint: 'Before the wedding', icon: 'sunrise' },
  'with-kids': { hint: 'Things they will love', icon: 'balloon' },
  architecture: { hint: 'Buildings worth the walk', icon: 'landmark' },
  'food-drink': { hint: 'Where we would eat', icon: 'dinner' },
  'stay-inside-caa': { hint: 'All under one roof', icon: 'building' },
};
const MOST_STARTERS = 6;
const NO_ITINERARIES: PlannerItinerary[] = [];
const PLAIN_PROFILE = profileOf(null, null);
const PREFS_SAVED = 'Saved. New ideas will fit this.';
const PREFS_ELSEWHERE = 'You changed this on another device since. Those answers are kept; change them here if you like.';
const PREFS_FAILED = 'We could not save that just now. Your answers still apply on this page.';
/** A page brought back into view asks again for the saved plans, at most this often. */
const FRESH_MS = 15_000;

/**
 * The starters: one for each of the couple's own itineraries a guest can use (each sends a request
 * that lands on it), then the plain ones for what no itinerary covers, and "Plan my whole weekend"
 * last. The wedding itself is not among them: it is on the guest's plans already, and they came
 * here for the hours around it.
 */
export function startersFor(itineraries: readonly PlannerItinerary[], placeIds: ReadonlySet<string>): Starter[] {
  const own: (Starter & { key: string })[] = [];
  for (const it of itineraries) {
    if (!it.stops.some((s) => placeIds.has(s.placeId))) continue;
    const s = itineraryStarter(it);
    const look = BUCKET_LOOK[it.bucket];
    if (!s || !look || own.some((o) => o.key === it.bucket)) continue;
    own.push({ key: it.bucket, label: s.label, request: s.request, ...look });
  }
  const covered = new Set(own.map((o) => o.key));
  // A time itinerary stands in for "I have two hours".
  if (own.some((o) => o.key === '45-min' || o.key === '2-3-h')) covered.add('2-3-h');
  const weekend = STARTERS.find((s) => s.key === 'weekend')!;
  const plain = STARTERS.filter((s) => s.key !== 'weekend' && !covered.has(s.key));
  return [...[...own, ...plain].slice(0, MOST_STARTERS - 1), weekend].map(({ label, hint, request, icon }) => ({ label, hint, request, icon }));
}

const PART_LABEL: Record<Part, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const PART_ICON: Record<Part, IconName> = { morning: 'sunrise', afternoon: 'sun', evening: 'moon' };
/** How long an answer may wait for the matcher's ranking before it is shown without it. */
const MATCH_WAIT_MS = 1200;
/** How long an answer waits for the search of the neighbourhood before it is shown without it. */
const SEARCH_WAIT_MS = 4500;
const DIET_LABEL: Record<Diet, string> = { vegetarian: 'Vegetarian', vegan: 'Vegan', 'gluten-free': 'Gluten-free', halal: 'Halal', kosher: 'Kosher' };
const MEAL_LABEL: Record<Meal, string> = { quick: 'Quick and casual', 'sit-down': 'A sit-down meal', special: 'Something special' };
/** Answers that are facts, not a choice of places: nothing to rank. */
const NO_RANKING = new Set<Plan['shape']>(['calendar', 'stay', 'arrive', 'schedule', 'own', 'clarify']);
const SAVE_FAILED = 'We could not save that just now. Please try again in a moment.';
const REMOVE_FAILED = 'We could not take that out just now. Please try again in a moment.';
const TOAST_MS = 5000;

/** A note after a change. `open` offers My plans; `undo` puts back what was just taken out. */
type ToastState = { text: string; key: number; open: boolean; undo?: () => void };

const SPEECH_ERROR: Record<DictationError, string> = {
  'not-allowed': 'We could not use your microphone. You can type instead.',
  'no-speech': 'We did not catch that. Try again, or type instead.',
  unavailable: 'Speaking is not available here. You can type instead.',
  failed: 'That did not work. Please type instead.',
};

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The places' vectors, computed once per session for the same list. */
let vectorCache: { key: string; vectors: number[][] } | null = null;
const placeText = (p: PlannerPlace) => [p.name, p.what, p.why, p.interests.join(', ')].filter(Boolean).join('. ');

async function placeVectors(places: PlannerPlace[], signal: AbortSignal): Promise<number[][] | null> {
  const key = places.map((p) => p.id).join('|');
  if (vectorCache?.key === key) return vectorCache.vectors;
  const vectors = await embed(places.map(placeText), { signal });
  if (!vectors || vectors.length !== places.length) return null;
  vectorCache = { key, vectors };
  return vectors;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<false>((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve(false)), { once: true });
  });

/**
 * The matcher's ranking of the places for a request, when the matcher is already installed. An
 * answer is drawn once and never rearranged, so it never waits on a download: a matcher that is not
 * ready yet is started for the next question instead.
 */
async function matchScores(request: string, places: PlannerPlace[], signal: AbortSignal): Promise<Map<string, number> | null> {
  if (getLocalModels().matcher.state !== 'ready') return null;
  const vectors = await placeVectors(places, signal);
  const query = vectors ? (await embed([request], { query: true, signal }))?.[0] : null;
  if (!vectors || !query || signal.aborted) return null;
  return new Map(places.map((p, i) => [p.id, vectors[i]!.reduce((sum, v, k) => sum + v * (query[k] ?? 0), 0)]));
}

export function TripPlanner({ places, saved: initialSaved, bookings, events, hotel, stay, itineraries = NO_ITINERARIES, actions, profile: initialProfile = PLAIN_PROFILE, prefs: initialPrefs }: TripPlannerProps) {
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const block = useMemo(() => stay ?? stayFacts(), [stay]);
  const baseStarters = useMemo(() => startersFor(itineraries, new Set(byId.keys())), [itineraries, byId]);
  const [saved, setSaved] = useState<PlannerSaved[]>(() => initialSaved.filter((s) => byId.has(s.id) || s.name));
  // The weekend as of the last change, for handlers that run between renders; every write updates both.
  const savedRef = useRef(saved);
  // Who the planner plans for. The ref is the same value for handlers that run between renders.
  const [who, setWho] = useState(initialProfile);
  const whoRef = useRef(who);
  const prefsAt = useRef<string | null>(initialPrefs?.updatedAt ?? null);
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const [whoBusy, setWhoBusy] = useState(false);
  const [whoProblem, setWhoProblem] = useState<string | null>(null);
  /** Tells this guest's other tabs that something was saved. */
  const channel = useRef<BroadcastChannel | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [tab, setTab] = useState<TabKey>('plans');
  // The time the guest is finding something for ("Find ideas" on a part of a day): places they add go there.
  const [target, setTarget] = useState<Slot | null>(null);
  // A saved place to pick up on My plans ("Change the time" on its row in an answer).
  const [pickUp, setPickUp] = useState<{ id: string; n: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);
  // Pointed at or focused: a message is never taken away from under the guest.
  const [toastHeld, setToastHeld] = useState(false);
  const [speech, setSpeech] = useState<'none' | 'ready' | 'listening'>('none');
  const [speechNote, setSpeechNote] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const dictation = useRef<{ run: Dictation; abort: AbortController } | null>(null);
  /** Each place's changes, sent one after another. */
  const chains = useRef(new Map<string, Promise<boolean>>());
  const nextId = useRef(1);
  const lastPress = useRef<DOMRect | null>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  /** Where the guest was on each tab, to come back to. */
  const scrollAt = useRef<Partial<Record<TabKey, number>>>({});
  const tabNow = useRef<TabKey>('plans');
  /** The trip item behind each of the guest's own plans, once it is saved. */
  const ownItems = useRef(new Map<string, string>());
  const threadRef = useRef<HTMLOListElement>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    void speechSupport()
      .then((route) => alive && setSpeech(route === 'none' ? 'none' : 'ready'))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => () => (ctl.current?.abort(), dictation.current?.abort.abort()), []);
  // The matcher stays loaded while the planner is on the page; once it is gone, the idle timer decides.
  useEffect(() => holdLocal('matcher'), []);
  // A message with a button stays until it is closed or used (WCAG 2.2.1); a plain one goes after a
  // while, but never while it is pointed at or focused.
  const toastAction = (!!toast?.open && tab !== 'plans') || !!toast?.undo;
  useEffect(() => {
    if (!toast || toastAction || toastHeld) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, toastAction, toastHeld]);

  const say = useCallback((text: string, open = false, undo?: () => void) => {
    setToastHeld(false);
    setToast({ text, key: Date.now(), open, ...(undo ? { undo } : {}) });
  }, []);
  const closeToast = useCallback(() => {
    setToastHeld(false);
    setToast(null);
  }, []);
  const patch = useCallback((id: number, next: Partial<Turn>) => setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...next } : t))), []);

  /** Opens a tab, remembering where the guest was on the one they leave. */
  const show = useCallback((next: TabKey) => {
    if (tabNow.current !== next && typeof window !== 'undefined') scrollAt.current[tabNow.current] = window.scrollY;
    tabNow.current = next;
    setTab(next);
  }, []);
  // The two tabs are different lengths, so a switch made from deep inside one would otherwise leave
  // the guest wherever the browser clamps the page. They land where they last were on the tab they
  // open, or at its top; a switch made with the tabs in view moves nothing.
  const firstTab = useRef(true);
  useLayoutEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    const root = rootRef.current;
    if (!root || typeof window === 'undefined' || typeof window.scrollTo !== 'function') return;
    const pinned = parseFloat(getComputedStyle(tabsRef.current ?? root).top) || 0;
    const top = root.getBoundingClientRect().top + window.scrollY - pinned;
    const was = scrollAt.current[tab];
    const here = window.scrollY;
    // In one frame: a tab is a swap in place, never a slide down the page.
    // Deep in this tab last time, and at (or a line above) the planner's start now: back to that place.
    if (was !== undefined && was > top && here >= top - 120) window.scrollTo({ top: was, behavior: 'instant' });
    // Scrolled past the start with nowhere to go back to: the tab opens at its top.
    else if (here > top + 2) window.scrollTo({ top, behavior: 'instant' });
    // Otherwise the tabs are where the guest can see them, and nothing moves.
  }, [tab]);
  // A new question goes to the top of the screen, under the tabs, and stays there while its answer
  // arrives beneath it: the guest reads from the start of the answer, never from its end.
  const newest = turns.at(-1)?.id;
  useEffect(() => {
    if (newest === undefined) return;
    const turn = threadRef.current?.querySelector<HTMLElement>(`[data-turn="${newest}"]`);
    if (!turn || typeof turn.scrollIntoView !== 'function') return;
    // A short way is a glide; past a long answer it is placed at once, not flown over.
    const far = Math.abs(turn.getBoundingClientRect().top) > window.innerHeight * 1.5;
    turn.scrollIntoView({ block: 'start', behavior: far || reduced() ? 'instant' : 'smooth' });
  }, [newest]);

  const entriesFor = useCallback(
    (plans: readonly SavedItem[]): CalendarEntry[] => {
      const origin = typeof location === 'undefined' ? undefined : location.origin;
      // The block's check-in and check-out only for a guest staying in it: they may be staying elsewhere.
      const blockDays = staysInBlock(bookings, block) ? blockEntries(block) : [];
      return [...weddingEntries(events), ...planEntries(plans, byId, origin ? { origin } : {}), ...blockDays, ...tripEntries(bookings)];
    },
    [events, bookings, byId, block],
  );
  const calendarEntries = useCallback(() => entriesFor(savedRef.current), [entriesFor]);

  // The same plans, live, for any summary of them already in the thread.
  const liveCalendar = useMemo(() => calendarModel(entriesFor(saved)), [entriesFor, saved]);

  const composeFor = useCallback(
    (plan: Plan, outside?: readonly OutsidePick[]) =>
      compose(plan, { places: byId, saved: savedRef.current, events, hotel, ...(plan.shape === 'calendar' ? { calendar: calendarModel(calendarEntries()) } : {}), ...(outside ? { outside } : {}) }),
    [byId, events, hotel, calendarEntries],
  );
  // What the guest has said about themselves this visit (what they eat, the kind of meal), and the
  // last meal they asked about, so "Change what I eat" can answer it again.
  const lastMeal = useRef<string | null>(null);

  const setProfile = useCallback((next: TripProfile) => {
    whoRef.current = next;
    setWho(next);
  }, []);
  const openEditor = useCallback((open: boolean) => {
    editingRef.current = open;
    setEditing(open);
    if (!open) setWhoProblem(null);
  }, []);
  /**
   * Saves the guest's answers about themselves. They apply on this page at once; the save follows.
   * `quiet`: said in passing (an answer to a question in the thread), so no note is shown for it.
   */
  const savePrefs = useCallback(
    async (next: TripPrefs, quiet = false) => {
      setProfile(withPrefs(whoRef.current, next));
      setWhoProblem(null);
      if (!actions?.savePrefs) {
        if (!quiet) {
          openEditor(false);
          say(PREFS_SAVED);
        }
        return;
      }
      if (!quiet) setWhoBusy(true);
      const r = await actions.savePrefs({ prefs: next, basedOn: prefsAt.current }).catch(() => ({ ok: false as const, message: PREFS_FAILED }));
      if (!quiet) setWhoBusy(false);
      if (!r.ok) {
        // The answers stay as they are on this page; only the save is owed.
        if (quiet || !editingRef.current) say(r.message || PREFS_FAILED);
        else setWhoProblem(r.message || PREFS_FAILED);
        return;
      }
      prefsAt.current = r.updatedAt;
      setProfile(r.profile);
      channel.current?.postMessage('saved');
      if (r.conflict || !quiet) {
        openEditor(false);
        say(r.conflict ? PREFS_ELSEWHERE : PREFS_SAVED);
      }
    },
    [actions, setProfile, openEditor, say],
  );
  /** Back to what the invitation and RSVP say. */
  const clearPrefs = useCallback(async () => {
    if (!actions?.savePrefs) {
      setProfile(initialProfile);
      openEditor(false);
      return;
    }
    setWhoBusy(true);
    const r = await actions.savePrefs({ prefs: { diet: null, meal: null, budget: null, stepFree: null, shortWalks: null, interests: [], kids: null, asked: false } }).catch(() => ({ ok: false as const, message: PREFS_FAILED }));
    setWhoBusy(false);
    if (!r.ok) return setWhoProblem(r.message || PREFS_FAILED);
    prefsAt.current = r.updatedAt;
    setProfile(r.profile);
    channel.current?.postMessage('saved');
    openEditor(false);
    say('Cleared. The ideas go back to what your invitation says.');
  }, [actions, initialProfile, setProfile, openEditor, say]);

  /**
   * The plans and profile as they are saved now. Asked when the page comes back into view, and when
   * another tab of the guest's says it saved something, so a phone and a laptop agree without a
   * reload. Nothing is replaced while a change of this page's own is still being saved.
   */
  const refresh = useCallback(async () => {
    if (!actions?.refresh || chains.current.size) return;
    const r = await actions.refresh().catch(() => null);
    if (!r?.ok || chains.current.size) return;
    // A plan of the guest's own made on this page keeps the key this page gave it.
    const mine = new Map([...ownItems.current].map(([id, item]) => [item, id]));
    const next = r.saved.filter((x) => byId.has(x.id) || x.name).map((x) => (x.own && x.itemId && mine.has(x.itemId) ? { ...x, id: mine.get(x.itemId)! } : x));
    const key = (all: readonly PlannerSaved[]) => all.map((x) => `${x.id}|${x.day}|${x.part}|${x.date ?? ''}|${x.name}`).sort().join('\n');
    if (key(next) !== key(savedRef.current)) {
      savedRef.current = next;
      setSaved(next);
    }
    if (!editingRef.current && r.updatedAt !== prefsAt.current) {
      prefsAt.current = r.updatedAt;
      setProfile(r.profile);
    }
  }, [actions, byId, setProfile]);
  useEffect(() => {
    if (!actions?.refresh || typeof document === 'undefined') return;
    let last = Date.now();
    const again = (force = false) => {
      if (document.visibilityState !== 'visible' || (!force && Date.now() - last < FRESH_MS)) return;
      last = Date.now();
      void refresh();
    };
    const onShow = () => again();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('wedding-trip-planner');
      bc.onmessage = () => again(true);
    } catch {
      // No channel in this browser: the next return to the page catches up instead.
    }
    channel.current = bc;
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
      bc?.close();
      channel.current = null;
    };
  }, [actions, refresh]);

  const send = useCallback(
    (raw: string, opts: { as?: string } = {}) => {
      const request = raw.trim();
      if (!request) return;
      ctl.current?.abort();
      const ac = new AbortController();
      ctl.current = ac;
      const id = nextId.current++;
      const me = whoRef.current;
      const prefs: Prefs = { diet: me.diet, meal: me.meal, asked: me.asked };
      const about = { request, places, saved: savedRef.current, itineraries, events, prefs, profile: me, ...(lastMeal.current ? { lastMeal: lastMeal.current } : {}) };
      const first = draftPlan(about);
      if (first.shape === 'clarify' && first.clarify) lastMeal.current = first.clarify.request;
      const matcher = getLocalModels().matcher.state;
      // The first use may start the matcher's install; this answer does not wait for it.
      if (matcher !== 'ready' && matcher !== 'unsupported') void ensureLocal('matcher', { userGesture: true }).catch(() => false);
      const rank = matcher === 'ready' && !NO_RANKING.has(first.shape);
      // Places beyond our own list are searched for before the answer is shown, so it is whole when it appears.
      const search = first.outside && actions?.searchNearby ? actions.searchNearby : null;
      const waiting = rank || !!search;
      // An earlier question still being answered is shown as it stands.
      setTurns((all) => [...all.map((t) => (t.waiting ? { ...t, waiting: false } : t)), { id, request: opts.as ?? request, program: composeFor(first), waiting }]);
      setDraft('');
      // A note about the last change is not carried into the next answer.
      closeToast();
      show('things');
      if (!waiting) return;
      const ranked = rank ? Promise.race([matchScores(request, places, ac.signal).catch(() => null), wait(MATCH_WAIT_MS, ac.signal)]) : Promise.resolve(null);
      const found = search
        ? Promise.race([search(first.outside!, places.map((p) => p.name)).then((r) => (r.ok ? r.places : null), () => null), wait(SEARCH_WAIT_MS, ac.signal).then(() => null)])
        : Promise.resolve(null);
      void Promise.all([ranked, found]).then(([scores, outside]) => {
        if (ac.signal.aborted) return;
        const better = scores ? draftPlan({ ...about, saved: savedRef.current, scores }) : first;
        patch(id, { program: composeFor(better, outside ?? undefined), waiting: false });
      });
    },
    [places, itineraries, events, actions, composeFor, patch, show, closeToast],
  );

  /** The guest's answer to what was asked before a meal: remembered for the visit, and the meal is answered with it. */
  const answerClarify = useCallback(
    (request: string, diet: Diet[], meal: Meal | null) => {
      // Kept with the guest's other answers, so they are not asked again on another visit or device.
      void savePrefs({ ...prefsOf(whoRef.current), diet, meal, asked: true }, true);
      lastMeal.current = request;
      const said = [...diet.map((d) => DIET_LABEL[d]), ...(meal ? [MEAL_LABEL[meal]] : [])];
      send(request, { as: said.length ? said.join(', ') : 'No preference' });
    },
    [send, savePrefs],
  );

  const startOver = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    setTurns([]);
    setTarget(null);
    setDraft('');
    lastMeal.current = null;
    closeToast();
    // Back at the suggestions, at the planner's start (the long thread under the guest is gone).
    const root = rootRef.current;
    if (root && typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      const pinned = parseFloat(getComputedStyle(tabsRef.current ?? root).top) || 0;
      const top = root.getBoundingClientRect().top + window.scrollY - pinned;
      if (window.scrollY > top) window.scrollTo({ top, behavior: 'instant' });
    }
    scrollAt.current.things = undefined;
    askRef.current?.focus({ preventScroll: true });
  }, [closeToast]);

  // ---------- the weekend ----------

  const fly = useCallback(() => {
    const from = lastPress.current;
    const to = tabRef.current?.getBoundingClientRect();
    if (!from || !to || reduced() || typeof document === 'undefined') return;
    const dot = document.createElement('span');
    dot.className = 'trip-fly';
    dot.setAttribute('aria-hidden', 'true');
    Object.assign(dot.style, { left: `${from.left + from.width / 2}px`, top: `${from.top + from.height / 2}px` });
    document.body.append(dot);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const anim = dot.animate?.([{ transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }, { transform: `translate(calc(${dx}px - 50%), calc(${dy}px - 50%)) scale(0.4)`, opacity: 0.2 }], { duration: 520, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' });
    if (anim) anim.finished.then(() => dot.remove(), () => dot.remove());
    else dot.remove();
  }, []);

  /** Every write to the board: applied to the latest board, so handlers between renders see it too. */
  const update = useCallback((change: (all: PlannerSaved[]) => PlannerSaved[]) => {
    const next = change(savedRef.current);
    if (next === savedRef.current) return;
    savedRef.current = next;
    setSaved(next);
  }, []);

  /**
   * Optimistic, one place at a time: the board changes now, and the place's change is sent after any
   * earlier one for the same place has settled. A failure puts back only this place, and only while
   * the board still shows what this change made (a later change to it wins), and says so.
   */
  const change = useCallback(
    (id: string, after: PlannerSaved | null, send: () => Promise<{ ok: boolean; message?: string }>): Promise<boolean> => {
      const before = savedRef.current.find((s) => s.id === id) ?? null;
      update((all) => (after ? (before ? all.map((s) => (s.id === id ? after : s)) : [...all, after]) : all.filter((s) => s.id !== id)));
      if (!actions) return Promise.resolve(true);
      const step = async () => {
        const r = await send().catch(() => ({ ok: false, message: undefined }));
        if (r.ok) {
          channel.current?.postMessage('saved');
          return true;
        }
        update((all) => {
          const now = all.find((s) => s.id === id) ?? null;
          const same = now && after ? savedDate(now) === savedDate(after) && now.part === after.part : now === after;
          if (!same) return all;
          if (!before) return all.filter((s) => s.id !== id);
          return now ? all.map((s) => (s.id === id ? before : s)) : [...all, before];
        });
        say(r.message || (after ? SAVE_FAILED : REMOVE_FAILED));
        return false;
      };
      const earlier = chains.current.get(id);
      const run = earlier ? earlier.then(step) : step();
      chains.current.set(id, run);
      void run.then(() => {
        if (chains.current.get(id) === run) chains.current.delete(id);
      });
      return run;
    },
    [actions, update, say],
  );

  /** Saves a place to a weekend day, or (with `date`) to a day of the stay before or after it. */
  const saveTo = useCallback(
    (id: string, name: string, day: Day, part: Part, date?: string) => {
      const was = savedRef.current.find((s) => s.id === id);
      const after: PlannerSaved = { ...(was ?? { name, ...(id.startsWith('own:') ? { own: true } : {}) }), id, name: was?.name ?? name, day, part, date };
      // A place moved back onto the weekend carries no date of its own.
      if (!date) delete after.date;
      if (!after.own) return change(id, after, () => actions!.save({ placeId: id, day, part, ...(date ? { date } : {}) }));
      // The guest's own plan: its trip item is known once its first save has come back (changes to one plan are sent in order).
      return change(id, after, async () => {
        const itemId = ownItems.current.get(id) ?? was?.itemId ?? undefined;
        const r = await actions!.saveOwn({ ...(itemId ? { itemId } : {}), title: after.name, day, part, ...(date ? { date } : {}) });
        if (r.ok) ownItems.current.set(id, r.itemId);
        return r;
      });
    },
    [actions, change],
  );

  /** The guest's own plan, in their words, on a part of a day. */
  const addOwn = useCallback(
    (slot: Slot, words: string, quiet = false) => {
      const name = words.replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!name) return;
      const at = slotForDate(slot.date);
      if (!at.date && isWeddingTime(at.day, slot.part)) return;
      const id = `own:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`;
      if (!quiet) say(`“${name}” is in your plans, ${slotName(slot.date, slot.part)}.`);
      // Shown at once and saved through the same one-at-a-time path as a move.
      void saveTo(id, name, at.day, slot.part, at.date);
    },
    [saveTo, say],
  );

  const add = useCallback(
    (id: string, day?: Day, part?: Part) => {
      const place = byId.get(id);
      if (!place) return;
      // The time the guest is filling wins over the answer's own suggestion for the place.
      const aimed = target ? slotForDate(target.date) : null;
      const slot = aimed && target ? { day: aimed.day, part: target.part, date: aimed.date } : { ...safeSlot(day ?? 'sat', part ?? 'morning'), date: undefined };
      fly();
      // The tabs are pinned, with the count beside My plans, so the note needs no button of its own.
      say(`${place.name} is in your plans, ${slotName(slot.date ?? weekendDate(slot.day), slot.part)}.`);
      void saveTo(id, place.name, slot.day, slot.part, slot.date);
    },
    [byId, saveTo, fly, say, target],
  );

  /** A place moved on My plans: to any day of the stay and part of the day, except the wedding's. */
  const move = useCallback(
    (id: string, date: string, part: Part) => {
      const slot = slotForDate(date);
      if (!slot.date && isWeddingTime(slot.day, part)) return;
      const item = savedRef.current.find((s) => s.id === id);
      if (!item || (savedDate(item) === date && item.part === part)) return;
      void saveTo(id, item.name, slot.day, part, slot.date);
    },
    [saveTo],
  );

  const remove = useCallback(
    (id: string) => {
      if (!savedRef.current.some((s) => s.id === id)) return;
      const item = savedRef.current.find((s) => s.id === id)!;
      if (!item.own) return void change(id, null, () => actions!.remove({ placeId: id }));
      void change(id, null, async () => {
        const itemId = ownItems.current.get(id) ?? item.itemId;
        return itemId ? actions!.removeOwn({ itemId }) : { ok: true };
      });
    },
    [actions, change],
  );
  /** Taken off the board with its bin: gone at once, with one tap to put it back where it was. */
  const removeWithUndo = useCallback(
    (id: string) => {
      const item = savedRef.current.find((s) => s.id === id);
      if (!item) return;
      const at = { date: savedDate(item), part: item.part };
      remove(id);
      say(`${item.own ? `“${item.name}”` : item.name} is out of your plans.`, false, () => {
        closeToast();
        if (item.own) return addOwn(at, item.name, true);
        const slot = slotForDate(at.date);
        void saveTo(item.id, item.name, slot.day, at.part, slot.date);
      });
    },
    [remove, say, closeToast, addOwn, saveTo],
  );

  /** A whole-weekend plan: adds what is new and moves what is elsewhere; never takes a place out. */
  const replaceWeekend = useCallback(
    (items: { id: string; day: Day; part: Part }[]) => {
      const wanted = items.filter((i) => byId.has(i.id)).map((i) => ({ ...i, ...safeSlot(i.day, i.part) }));
      const work = wanted
        .filter((w) => {
          const was = savedRef.current.find((s) => s.id === w.id);
          return !was || savedDate(was) !== savedDate(w) || was.part !== w.part;
        })
        .map((w) => saveTo(w.id, byId.get(w.id)!.name, w.day, w.part));
      void Promise.all(work).then((done) => done.every(Boolean) && say(work.length ? 'They are in your plans.' : 'These are already in your plans.', true));
    },
    [byId, saveTo, say],
  );

  const exportCalendar = useCallback(() => {
    const text = buildIcs({ items: calendarEntries(), now: new Date(), uidDomain: typeof location === 'undefined' ? 'wedding.local' : location.host || 'wedding.local' });
    downloadIcs(text, 'our-wedding-weekend.ics');
    say('Your calendar file is saved. Open it to add these plans to your calendar.');
  }, [calendarEntries, say]);

  /** "Find ideas" on a part of a day: asks for that time, and what the guest adds from the answer goes there. */
  const findFor = useCallback(
    (slot: Slot) => {
      setTarget(slot);
      send(`Ideas for ${slotName(slot.date, slot.part)}`);
    },
    [send],
  );
  /** "Change the time" on a saved place in an answer: My plans opens with it picked up. */
  const movePlan = useCallback(
    (id: string) => {
      if (!savedRef.current.some((s) => s.id === id)) return;
      closeToast();
      setPickUp((p) => ({ id, n: (p?.n ?? 0) + 1 }));
      show('plans');
    },
    [show, closeToast],
  );

  const onAction = useCallback(
    (action: TripAction) => {
      switch (action.type) {
        case 'AddToWeekend':
          return add(action.id, action.day, action.part);
        case 'RemoveFromWeekend':
          return remove(action.id);
        case 'AddOwn':
          return addOwn({ date: action.date ?? weekendDate(action.day), part: action.part }, action.title);
        case 'AnswerClarify':
          return answerClarify(action.request, action.diet, action.meal);
        case 'SetWeekend':
          return replaceWeekend(action.items);
        case 'MovePlan':
          return movePlan(action.id);
        case 'OpenPlans':
          return show('plans');
        case 'ConfirmWeekend':
          return send('Show my plans');
        case 'ExportCalendar':
          return exportCalendar();
        case 'Ask':
          return send(action.message);
      }
    },
    [add, remove, addOwn, answerClarify, replaceWeekend, movePlan, show, exportCalendar, send],
  );

  // ---------- speech ----------

  const toggleSpeech = useCallback(() => {
    if (dictation.current) {
      dictation.current.run.stop();
      return;
    }
    setSpeechNote(null);
    const abort = new AbortController();
    const before = draft.trim();
    const join = (words: string) => [before, words.trim()].filter(Boolean).join(' ');
    setSpeech('listening');
    // The speech model (when this device records instead) stays loaded for as long as the guest dictates.
    const release = holdLocal('speech');
    const run = startDictation({
      onInterim: (t) => setDraft(join(t)),
      onFinal: (t) => {
        setDraft(join(t));
        askRef.current?.focus();
      },
      onError: (e) => setSpeechNote(SPEECH_ERROR[e] ?? SPEECH_ERROR.failed),
      signal: abort.signal,
    });
    dictation.current = { run, abort };
    void run.done.finally(() => {
      release();
      if (dictation.current?.run === run) dictation.current = null;
      setSpeech((s) => (s === 'listening' ? 'ready' : s));
    });
  }, [draft]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    dictation.current?.run.stop();
    send(draft);
  };
  const onAskKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  // Ideas that fit this guest come first, in place of as many of the general ones.
  const starters = useMemo(() => {
    const own: Starter[] = profileStarters(who)
      .filter((label) => !baseStarters.some((b) => b.request === label))
      .map((label) => ({ label, hint: 'For you', request: label, icon: 'compass' as IconName }));
    if (!own.length) return baseStarters;
    // One idea for the children is enough: the general one gives way to theirs.
    const kids = own.some((o) => /\bkids\b/i.test(o.request));
    const rest = baseStarters.slice(0, -1).filter((b) => !(kids && /\bkids\b/i.test(b.request)));
    return [...own, ...rest.slice(0, Math.max(0, MOST_STARTERS - 1 - own.length)), baseStarters[baseStarters.length - 1]!];
  }, [who, baseStarters]);
  const savedItems: SavedItem[] = saved;
  const listening = speech === 'listening';
  const openPlans = tab === 'plans' ? undefined : () => (show('plans'), closeToast());

  return (
    <TripPlannerProvider places={byId} saved={savedItems} target={target} calendar={liveCalendar} hotel={hotel} stay={block} profile={who} onAction={onAction}>
      <div ref={rootRef} className="trip-planner" onPointerDownCapture={(e) => (lastPress.current = (e.target as Element).closest?.('button')?.getBoundingClientRect() ?? null)}>
        <div ref={tabsRef} className="trip-tabs" role="tablist" aria-label="Planner">
          {/* My plans first, and open first: what the guest has planned is what they come back for. */}
          <button ref={tabRef} type="button" role="tab" id="trip-tab-plans" aria-selected={tab === 'plans'} aria-controls="trip-panel-plans" tabIndex={tab === 'plans' ? 0 : -1} className="trip-tab" onClick={() => show('plans')} onKeyDown={(e) => e.key === 'ArrowRight' && (show('things'), document.getElementById('trip-tab-things')?.focus())}>
            <Icon name="calendar" className="trip-icon trip-tab__icon" />
            My plans
            {saved.length ? (
              <span className="trip-tab__count" key={saved.length}>
                {saved.length}
                <span className="sr-only"> added</span>
              </span>
            ) : null}
          </button>
          <button type="button" role="tab" id="trip-tab-things" aria-selected={tab === 'things'} aria-controls="trip-panel-things" tabIndex={tab === 'things' ? 0 : -1} className="trip-tab" onClick={() => show('things')} onKeyDown={(e) => e.key === 'ArrowLeft' && (show('plans'), tabRef.current?.focus())}>
            <Icon name="compass" className="trip-icon trip-tab__icon" />
            Things to do
          </button>
        </div>

        <div id="trip-panel-things" role="tabpanel" aria-labelledby="trip-tab-things" hidden={tab !== 'things'} className="trip-panel trip-panel--things">
          <TripProfileBar profile={who} open={editing} busy={whoBusy} problem={whoProblem} onOpen={() => openEditor(true)} onClose={() => openEditor(false)} onSave={(next) => void savePrefs(next)} {...(who.saved ? { onClear: () => void clearPrefs() } : {})} />
          {turns.length === 0 ? (
            <div className="trip-open">
              <p className="trip-text trip-text--md">Ask for an idea, or start with one of these. Anything you like can go straight into your plans.</p>
              <div className="trip-starters" role="group" aria-label="Ideas to start with">
                {starters.map((s) => (
                  <button key={s.label} type="button" className="trip-starter" onClick={() => send(s.request)}>
                    <Icon name={s.icon} className="trip-starter__icon" />
                    <span className="trip-starter__label">{s.label}</span>
                    <span className="trip-starter__hint">{s.hint}</span>
                    <Icon name="arrow-right" className="trip-icon trip-icon--sm trip-starter__go" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ol ref={threadRef} className="trip-thread" aria-label="Your questions and our answers">
              {turns.map((t) => (
                <li key={t.id} data-turn={t.id} className="trip-turn" aria-busy={t.waiting}>
                  <p className="trip-turn__asked">
                    <span className="sr-only">You asked: </span>
                    {t.request}
                  </p>
                  {t.waiting ? (
                    <p className="trip-typing" role="status">
                      <span className="sr-only">Finding the best fit</span>
                      <span className="trip-typing__dot" aria-hidden="true" />
                      <span className="trip-typing__dot" aria-hidden="true" />
                      <span className="trip-typing__dot" aria-hidden="true" />
                    </p>
                  ) : (
                    <div className="trip-turn__answer">
                      <TripRenderer response={t.program} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}

          <form className="trip-ask" onSubmit={submit}>
            <div className="trip-toast trip-toast--ask" role="status" aria-live="polite">
              {toast && tab === 'things' ? <Toast toast={toast} onOpen={openPlans} onClose={closeToast} onHold={setToastHeld} /> : null}
            </div>
            <div className="trip-ask__row">
              <label className="sr-only" htmlFor="trip-ask-input">
                Ask us about the weekend
              </label>
              <textarea
                ref={askRef}
                id="trip-ask-input"
                className="trip-ask__input"
                rows={1}
                value={draft}
                placeholder="Ask about the weekend…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onAskKey}
              />
              {speech !== 'none' ? (
                <button
                  type="button"
                  className={`trip-round trip-ask__mic${listening ? ' is-on' : ''}`}
                  aria-pressed={listening}
                  aria-label={listening ? 'Stop listening' : 'Speak instead'}
                  title={listening ? 'Stop listening' : 'Speak instead'}
                  onClick={toggleSpeech}
                >
                  {listening ? <Icon name="stop" filled className="trip-icon trip-icon--sm" /> : <Icon name="mic" className="trip-icon" />}
                </button>
              ) : null}
              <button type="submit" className="trip-round trip-ask__send" aria-label="Ask" title="Ask" disabled={!draft.trim()}>
                <Icon name="send" className="trip-icon" strokeWidth="2" />
              </button>
            </div>
            {listening ? (
              <p className="trip-caption trip-ask__listening">
                <span className="trip-ask__dot" aria-hidden="true" />
                Listening. Tap the square when you are done.
              </p>
            ) : null}
            {speechNote ? (
              <p className="trip-caption trip-ask__note" role="status">
                {speechNote}
              </p>
            ) : null}
            {target || turns.length ? (
              <div className="trip-ask__meta">
                {target ? (
                  // A chip with its own way out, the way a filter is shown: what is added goes to this time until it is closed.
                  <p className="trip-ask__target">
                    <Icon name="calendar-plus" className="trip-icon trip-icon--sm trip-icon--accent" />
                    <span>{`Adding to ${slotName(target.date, target.part)}`}</span>
                    <button type="button" className="trip-ask__untarget" aria-label={`Stop adding to ${slotName(target.date, target.part)}`} title="Stop adding to this time" onClick={() => setTarget(null)}>
                      <Icon name="close" className="trip-icon trip-icon--sm" />
                    </button>
                  </p>
                ) : null}
                {turns.length ? (
                  <button type="button" className="trip-link trip-ask__reset" onClick={startOver}>
                    <Icon name="restart" className="trip-icon trip-icon--sm" />
                    Clear and start over
                  </button>
                ) : null}
              </div>
            ) : null}
          </form>
        </div>

        <div id="trip-panel-plans" role="tabpanel" aria-labelledby="trip-tab-plans" hidden={tab !== 'plans'} className="trip-panel">
          <Board saved={saved} byId={byId} events={events} bookings={bookings} stay={block} hotel={hotel} pickUp={pickUp} onMove={move} onRemove={removeWithUndo} onAddOwn={addOwn} onFind={findFor} onCalendar={exportCalendar} onAsk={send} persist={!!actions} />
        </div>

        <div className="trip-toast trip-toast--float" role="status" aria-live="polite">
          {toast && tab !== 'things' ? <Toast toast={toast} onOpen={openPlans} onClose={closeToast} onHold={setToastHeld} /> : null}
        </div>
      </div>
    </TripPlannerProvider>
  );
}

/** A short note after a change: what happened, where to see it, and a way to close it. */
function Toast({
  toast,
  onOpen,
  onClose,
  onHold,
}: {
  toast: ToastState;
  onOpen: (() => void) | undefined;
  onClose: () => void;
  /** Pointed at or focused: the message is not taken away from under the guest. */
  onHold: (held: boolean) => void;
}) {
  return (
    <div
      className="trip-toast__box"
      key={toast.key}
      onMouseEnter={() => onHold(true)}
      onMouseLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && onHold(false)}
    >
      <Icon name="check" className="trip-icon trip-toast__mark" />
      <span className="trip-toast__text">{toast.text}</span>
      {toast.undo ? (
        <button type="button" className="trip-toast__open" onClick={toast.undo}>
          <Icon name="restart" className="trip-icon trip-icon--sm" />
          Put it back
        </button>
      ) : toast.open && onOpen ? (
        <button type="button" className="trip-toast__open" onClick={onOpen}>
          See my plans
          <Icon name="arrow-right" className="trip-icon trip-icon--sm" />
        </button>
      ) : null}
      <button type="button" className="trip-round trip-toast__close" aria-label="Close" title="Close" onClick={onClose}>
        <Icon name="close" className="trip-icon" />
      </button>
    </div>
  );
}

const isPartKey = (v: unknown): v is Part => v === 'morning' || v === 'afternoon' || v === 'evening';
const isDateKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** A slot's key, "YYYY-MM-DD-part", read back into its date and part. */
const slotKey = (date: string, part: Part) => `${date}-${part}`;
const readSlot = (key: string | undefined): { date: string; part: Part } | null => {
  if (!key) return null;
  const at = key.lastIndexOf('-');
  const date = key.slice(0, at);
  const part = key.slice(at + 1);
  return isDateKey(date) && isPartKey(part) ? { date, part } : null;
};

/** "1:30 PM" from "13:30". */
function clockOf(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** One line of a day's own agenda: a flight, a hotel stay's check-in or check-out, a wedding event. `at` is its "HH:MM", when it has one. */
type DayLine = { key: string; at: string | null; icon: IconName; text: string };

/** The part of the day a time falls in: before noon, before five, then the evening. */
function partOf(hhmm: string): Part {
  const h = Number(hhmm.slice(0, 2));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

/**
 * What the guest has booked, by day: each flight on the day it leaves and the day it lands, each hotel
 * stay on its check-in and check-out days, at the times the guest gave (in the wedding's time zone).
 */
function bookingLines(bookings: readonly TripItemInput[]): Map<string, DayLine[]> {
  const out = new Map<string, DayLine[]>();
  const put = (date: string, line: DayLine) => out.set(date, [...(out.get(date) ?? []), line]);
  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    const start = b.startAt ? wallTime(b.startAt) : null;
    const end = b.endAt ? wallTime(b.endAt) : null;
    if (b.kind === 'flight') {
      if (start) put(start.date, { key: `${b.id}-out`, at: start.time, icon: 'plane', text: `${b.title} departs` });
      if (end) put(end.date, { key: `${b.id}-in`, at: end.time, icon: 'plane', text: `${b.title} lands` });
    } else if (b.kind === 'hotel') {
      const name = b.hotelName || b.title;
      if (start) put(start.date, { key: `${b.id}-in`, at: start.time, icon: 'bed', text: `Check in at ${name}` });
      if (end) put(end.date, { key: `${b.id}-out`, at: end.time, icon: 'bed', text: `Check out of ${name}` });
    }
  }
  return out;
}

/** A fixed line of the day: its icon, its time in a column of its own, and what happens. */
function FixedLine({ line }: { line: DayLine }) {
  return (
    <p className="trip-fixed">
      <Icon name={line.icon} className="trip-icon trip-icon--sm trip-icon--accent" />
      {line.at ? <span className="trip-fixed__time">{clockOf(line.at)}</span> : null}
      <span className="trip-fixed__text">{line.text}</span>
    </p>
  );
}

/**
 * My plans: every day of the guest's stay, from the first thing they have booked or saved to the
 * last, never less than Friday to Sunday, and a day more either side when they ask for it. Each day
 * lists what is fixed (flights, hotel check-in and check-out, the wedding's events) and, by part of the
 * day, the places they saved, each with a tentative time, how long it takes and the way from the one
 * before. Saturday afternoon and evening belong to the wedding, and list its events.
 */
function Board({
  saved,
  byId,
  events,
  bookings,
  stay,
  hotel,
  pickUp,
  onMove,
  onRemove,
  onAddOwn,
  onFind,
  onCalendar,
  onAsk,
  persist,
}: {
  saved: PlannerSaved[];
  byId: ReadonlyMap<string, PlannerPlace>;
  events: readonly WeddingEventInput[];
  bookings: readonly TripItemInput[];
  stay: StayFacts;
  hotel: TripHotel | null;
  /** A plan to pick up as the board opens ("Change the time" on a place in an answer). */
  pickUp: { id: string; n: number } | null;
  onMove: (id: string, date: string, part: Part) => void;
  onRemove: (id: string) => void;
  /** The guest's own plan, in their words, on a part of a day. */
  onAddOwn: (slot: Slot, words: string) => void;
  /** Ideas for a part of a day, from Things to do. */
  onFind: (slot: Slot) => void;
  onCalendar: () => void;
  onAsk: (request: string) => void;
  persist: boolean;
}) {
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // A place picked up by a tap (or Enter) on its handle: every other time then offers "Move here".
  // Dragging is never the only way to move one (WCAG 2.2, 2.5.7).
  const [picked, setPicked] = useState<string | null>(null);
  // The part of a day the guest is adding to ("Add" on it): its form is open in place.
  const [adding, setAdding] = useState<string | null>(null);
  const [words, setWords] = useState('');
  // Days the guest added before or after the weekend, before anything is planned on them.
  const [added, setAdded] = useState<string[]>([]);
  const drag = useRef<{ id: string; pointer: number; x: number; y: number; scroll: number; at: { x: number; y: number }; moved: boolean; card: HTMLElement | null; frame: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  // A moved card is drawn again in its new slot, and a removed one is gone: keyboard focus follows
  // to the moved card's handle, or to the next card that day (else the day's heading).
  const focusNext = useRef<{ kind: 'move'; id: string } | { kind: 'remove'; date: string; next: string | null } | null>(null);
  useEffect(() => {
    const want = focusNext.current;
    focusNext.current = null;
    const root = boardRef.current;
    if (!want || !root) return;
    const card = (id: string) => root.querySelector<HTMLElement>(`[data-saved-id="${id}"]`);
    // Without scrolling: the plan is where the guest's finger just was, and the page stays put.
    if (want.kind === 'move') card(want.id)?.querySelector<HTMLElement>('.trip-saved__grip')?.focus({ preventScroll: true });
    else ((want.next ? card(want.next)?.querySelector<HTMLElement>('.trip-saved__remove') : null) ?? document.getElementById(`trip-day-${want.date}`))?.focus({ preventScroll: true });
  }, [saved]);
  // When the form in a part of the day closes (added, cancelled, Escape), focus goes back to that part's Add.
  const wasAdding = useRef<string | null>(null);
  useEffect(() => {
    const before = wasAdding.current;
    wasAdding.current = adding;
    if (before && !adding) boardRef.current?.querySelector<HTMLElement>(`[data-slot="${before}"] .trip-slot__add`)?.focus({ preventScroll: true });
  }, [adding]);
  // "Change the time" on a place in an answer: the board opens with that plan picked up and in view.
  const pickN = pickUp?.n ?? 0;
  const [pickSeen, setPickSeen] = useState(0);
  if (pickUp && pickN !== pickSeen) {
    // A new request, taken up as the board renders (not when the plans change under an old one).
    setPickSeen(pickN);
    if (saved.some((x) => x.id === pickUp.id)) {
      setAdding(null);
      setPicked(pickUp.id);
    }
  }
  useEffect(() => {
    if (!pickUp) return;
    boardRef.current?.querySelector<HTMLElement>(`[data-saved-id="${pickUp.id}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickN]);
  /** A picked-up plan put back where it was (Cancel, or Escape): focus returns to its Move. */
  const putDown = (id: string) => {
    focusNext.current = { kind: 'move', id };
    setPicked(null);
    boardRef.current?.querySelector<HTMLElement>(`[data-saved-id="${id}"] .trip-saved__grip`)?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!picked) return;
    const cancel = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && putDown(picked);
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [picked]);

  // A drag cut short by the board going away stops scrolling the page.
  useEffect(() => () => cancelAnimationFrame(drag.current?.frame ?? 0), []);
  const booked = useMemo(() => bookingLines(bookings), [bookings]);
  const days = useMemo(
    () => stayDays([...saved.map((x) => savedDate(x)), ...booked.keys(), ...added]),
    [saved, booked, added],
  );
  const wedding = (date: string, part: Part) => {
    const day = dayOfDate(date);
    return !!day && isWeddingTime(day, part);
  };
  const inSlot = (date: string, part: Part) => saved.filter((x) => savedDate(x) === date && x.part === part);

  const moveTo = (id: string, date: string, part: Part) => {
    const s = saved.find((x) => x.id === id);
    if (!s) return;
    if (savedDate(s) !== date || s.part !== part) focusNext.current = { kind: 'move', id };
    setPicked(null);
    onMove(id, date, part);
  };
  const removeFrom = (s: PlannerSaved) => {
    const date = savedDate(s);
    const thatDay = PARTS.flatMap((part) => inSlot(date, part));
    focusNext.current = { kind: 'remove', date, next: thatDay[thatDay.indexOf(s) + 1]?.id ?? null };
    onRemove(s.id);
  };
  /** The time under the pointer, ignoring the card being dragged (it follows the pointer). */
  const slotAt = (x: number, y: number, card: HTMLElement | null): HTMLElement | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (card?.contains(el)) continue;
      const slot = (el as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (slot) return slot;
    }
    return null;
  };
  // Dragging with a mouse, a finger or a pen alike (pointer events): the handle is held, the card
  // follows, and the time under it lights up; letting go there moves it.
  /** The held card follows the pointer, and the page under it, as it scrolls. */
  const follow = () => {
    const d = drag.current;
    if (!d) return;
    if (d.card) d.card.style.translate = `${d.at.x - d.x}px ${d.at.y - d.y + window.scrollY - d.scroll}px`;
    setOver(slotAt(d.at.x, d.at.y, d.card)?.dataset.slot ?? null);
  };
  // Near the top or bottom of the screen the page scrolls while a place is held, faster the closer it
  // is, so a finger can carry a place to a day that was off the screen (the handle keeps the finger
  // from scrolling the page itself).
  const EDGE = 72;
  const edgeScroll = () => {
    const d = drag.current;
    if (!d || !d.moved) return;
    const h = window.innerHeight;
    const step = d.at.y < EDGE ? -Math.ceil((EDGE - d.at.y) / 4) : d.at.y > h - EDGE ? Math.ceil((d.at.y - (h - EDGE)) / 4) : 0;
    if (step) {
      window.scrollBy(0, step);
      follow();
    }
    d.frame = requestAnimationFrame(edgeScroll);
  };
  // Dragging with a mouse, a finger or a pen alike (pointer events): the handle is held, the card
  // follows, and the time under it lights up; letting go there moves it.
  const onGripDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, pointer: e.pointerId, x: e.clientX, y: e.clientY, scroll: window.scrollY, at: { x: e.clientX, y: e.clientY }, moved: false, card: e.currentTarget.closest('article'), frame: 0 };
  };
  const onGripMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    d.at = { x: e.clientX, y: e.clientY };
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(d.id);
      setPicked(null);
      d.frame = requestAnimationFrame(edgeScroll);
    }
    follow();
  };
  const onGripUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    cancelAnimationFrame(d.frame);
    if (d.card) d.card.style.translate = '';
    if (d.moved) {
      const slot = readSlot(slotAt(e.clientX, e.clientY, d.card)?.dataset.slot);
      if (slot) moveTo(d.id, slot.date, slot.part);
    }
    setDragging(null);
    setOver(null);
    // A drag ends without the click that a tap would bring; a tap's click picks the card up.
    if (!d.moved) drag.current = null;
    else setTimeout(() => (drag.current = null), 0);
  };
  const onGripClick = (id: string) => {
    if (drag.current?.moved) return;
    drag.current = null;
    setPicked((p) => (p === id ? null : id));
  };
  const pickedPlace = picked ? (byId.get(picked)?.name ?? saved.find((x) => x.id === picked)?.name ?? '') : '';

  // Each day's places in the order of the day: a tentative time for each (the part of the day it is
  // in, then one after another), how long it takes, and the way from the one before (or the hotel).
  const dayPlan = (date: string) => {
    const order = PARTS.flatMap((part) => inSlot(date, part));
    const stops = order.flatMap((x) => {
      const place = byId.get(x.id);
      return place ? [{ x, place }] : [];
    });
    const route = planRoute({ stops: stops.map(({ x, place }) => ({ place, part: x.part })), hotel });
    const at = new Map(stops.map(({ x }, i) => [x.id, route.stops[i]!]));
    return { order, at };
  };
  const wayTo = (s: PlannerSaved, order: PlannerSaved[]): { text: string; icon: IconName } | null => {
    const i = order.indexOf(s);
    const here = byId.get(s.id);
    if (!here || typeof here.lat !== 'number' || typeof here.lng !== 'number') return null;
    // The way from the plan before it only within one part of the day: hours pass between a morning
    // and an evening, and the guest sets out again from the hotel.
    const before = i > 0 && order[i - 1]!.part === s.part ? order[i - 1]! : null;
    const prev = before ? byId.get(before.id) : null;
    const from = prev && typeof prev.lat === 'number' && typeof prev.lng === 'number' ? { name: prev.name, at: { lat: prev.lat, lng: prev.lng } } : !before && hotel ? { name: 'our hotel', at: hotel } : null;
    if (!from) return null;
    const leg = legBetween(from.at, { lat: here.lat, lng: here.lng });
    if (leg.mode === 'same') return { text: from.name === 'our hotel' ? 'In our hotel' : `Same building as ${from.name}`, icon: 'pin' };
    // The icon is the way the line starts with: a walk that could also be a ride is a walk.
    return { text: `From ${from.name}: ${leg.text[0]!.toLowerCase()}${leg.text.slice(1)}`, icon: leg.mode === 'walk' ? 'walk' : 'car' };
  };
  /** How long a part of the day's places take, with the way from one to the next. */
  const slotMinutes = (items: PlannerSaved[]): number => {
    const places = items.map((x) => byId.get(x.id)).filter((p): p is PlannerPlace => !!p);
    return places.length ? planRoute({ stops: places.map((place) => ({ place })) }).totalMinutes : 0;
  };
  const schedule = useMemo(() => scheduleOf(events), [events]);
  const startOf = useMemo(() => new Map(events.map((e) => [e.id, e.startsAt ? wallTime(typeof e.startsAt === 'string' ? e.startsAt : e.startsAt.toISOString()) : null])), [events]);
  // A guest with a hotel stay of their own has their own check-in and check-out; the block's dates
  // would only contradict them.
  const ownHotel = bookings.some((b) => b.kind === 'hotel' && b.status !== 'cancelled');
  const first = days[0]!;
  const last = days.at(-1)!;
  const before = addDays(first, -1);
  const after = addDays(last, 1);
  const canAdd = (date: string) => days.length < STAY_MAX_DAYS && stayDays([date]).includes(date);

  /**
   * A day's fixed lines: those with a time go into the part of the day they fall in, in time order;
   * those without one (the room block's days, an event whose time is not announced) head the day.
   */
  const fixedLines = (date: string): { head: DayLine[]; byPart: Record<Part, DayLine[]> } => {
    const all = [...(booked.get(date) ?? [])];
    if (!ownHotel && stay.checkIn === date) all.push({ key: 'block-in', at: null, icon: 'bed', text: 'Our room block: check-in' });
    if (!ownHotel && stay.checkOut === date) all.push({ key: 'block-out', at: null, icon: 'bed', text: 'Our room block: check-out' });
    // Saturday's own events are listed in its wedding slot; other days' here.
    if (dayOfDate(date) !== 'sat') {
      for (const e of schedule.filter((x) => x.dateIso === date)) {
        const wall = startOf.get(e.id);
        const at = wall && wall.date === date ? wall.time : null;
        all.push({ key: e.id, at, icon: 'rings', text: at ? e.name : `${e.name}: ${timeText(e)}` });
      }
    }
    const byPart: Record<Part, DayLine[]> = { morning: [], afternoon: [], evening: [] };
    for (const l of all) if (l.at) byPart[partOf(l.at)].push(l);
    for (const part of PARTS) byPart[part].sort((x, y) => x.at!.localeCompare(y.at!));
    return { head: all.filter((l) => !l.at), byPart };
  };

  const addDayButton = (date: string, where: 'before' | 'after') =>
    canAdd(date) ? (
      <button type="button" className={`trip-days__add trip-days__add--${where}`} onClick={() => setAdded((a) => [...a, date])}>
        <Icon name="calendar-plus" className="trip-icon trip-icon--sm" />
        {`${where === 'before' ? 'Here earlier' : 'Staying longer'}? Add ${dateLabel(date)}`}
      </button>
    ) : null;

  const savedCard = (s: PlannerSaved, order: PlannerSaved[], at: Map<string, { start: number | null; end: number | null }>) => {
    const place = byId.get(s.id);
    const name = place?.name ?? s.name;
    const stop = at.get(s.id);
    const when = stop && stop.start !== null && stop.end !== null ? `Around ${clockSpan(stop.start, stop.end)}` : null;
    const howLong = place ? aboutHowLong(stopMinutes(place).minutes) : null;
    const way = wayTo(s, order);
    // Known to be shut at the time it is planned for: said on the plan itself, where it can be moved.
    const shut = place ? knowBeforeYouGo(place, { date: savedDate(s), part: s.part }).shut : null;
    const isPicked = picked === s.id;
    return (
      <article key={s.id} data-saved-id={s.id} className={`trip-saved${s.own ? ' trip-saved--own' : ''}${dragging === s.id ? ' is-dragging' : ''}${isPicked ? ' is-picked' : ''}`}>
        <h4 className="trip-saved__name">{place ? <a className="bd-link" href={place.href}>{name}</a> : name}</h4>
        <div className="trip-saved__tools">
          <button
            type="button"
            className="trip-saved__grip"
            aria-label={isPicked ? `Keep ${name} where it is` : `Move ${name}`}
            aria-pressed={isPicked}
            onPointerDown={(e) => onGripDown(e, s.id)}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            onClick={() => onGripClick(s.id)}
          >
            <Icon name="grip" className="trip-icon trip-icon--sm" strokeWidth="3" />
            <span aria-hidden="true">{isPicked ? 'Cancel' : 'Move'}</span>
          </button>
          <button type="button" className="trip-round trip-saved__remove" aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={() => removeFrom(s)}>
            <Icon name="trash" className="trip-icon" />
          </button>
        </div>
        {when || howLong || way || shut ? (
          <div className="trip-saved__facts">
            {shut ? (
              <p className="trip-saved__fact trip-saved__fact--shut">
                <Icon name="clock" className="trip-icon trip-icon--sm" />
                {`${shut} Move it to another time.`}
              </p>
            ) : null}
            {when || howLong ? (
              <p className="trip-saved__fact">
                <Icon name="clock" className="trip-icon trip-icon--sm trip-icon--accent" />
                {[when, howLong ? howLong.toLowerCase() : null].filter(Boolean).join(', ')}
              </p>
            ) : null}
            {way ? (
              <p className="trip-saved__fact">
                <Icon name={way.icon} className="trip-icon trip-icon--sm trip-icon--accent" />
                {way.text}
              </p>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <div className="trip-board" ref={boardRef}>
      {/* Every control on the board says what it does. The one thing said in a sentence is what to do
          next while a plan is picked up, and it stays under the tabs wherever the guest scrolls to. */}
      <div className="trip-board__say" role="status">
        {picked ? (
          <div className="trip-board__say-box">
            <span>{`Choose a new time for ${pickedPlace}.`}</span>
            <button type="button" className="trip-link" aria-label="Cancel the move" onClick={() => putDown(picked)}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
      <div className="trip-board__bar">
        {persist ? null : <p className="trip-text trip-text--md">These plans are kept on this page only.</p>}
        <div className="trip-board__actions">
          {/* Always there, so the board above the days is the same height before and after a first plan. */}
          <button type="button" className="trip-chip" onClick={() => onAsk('Plan my whole weekend')}>
            Plan my whole weekend
          </button>
          <button type="button" className="trip-chip trip-chip--icon" onClick={onCalendar}>
            <Icon name="calendar-plus" className="trip-icon trip-icon--sm" />
            Add to my calendar
          </button>
        </div>
      </div>
      <div className="trip-days" data-count={days.length}>
        {addDayButton(before, 'before')}
        {days.map((date) => {
          const { order, at } = dayPlan(date);
          const fixed = fixedLines(date);
          const [weekday, monthDay] = dateLabel(date).split(', ');
          return (
            <section key={date} className="trip-day" aria-labelledby={`trip-day-${date}`}>
              <div className="trip-day__head">
                <h3 id={`trip-day-${date}`} className="trip-day__date" tabIndex={-1}>
                  <span className="trip-day__weekday">
                    {weekday}
                    <span className="trip-day__comma">,</span>
                  </span>{' '}
                  <span className="trip-day__monthday">{monthDay}</span>
                </h3>
                {/* A day the guest added and has put nothing on can be taken off again, from either end. */}
                {added.includes(date) && (date === first || date === last) && !order.length && !booked.has(date) ? (
                  <button type="button" className="trip-link trip-day__drop" aria-label={`Remove this day, ${dateLabel(date)}`} onClick={() => setAdded((a) => a.filter((d) => d !== date))}>
                    Remove this day
                  </button>
                ) : null}
                {fixed.head.length ? (
                  <ul className="trip-day__facts">
                    {fixed.head.map((l) => (
                      <li key={l.key} className="trip-day__fact">
                        <Icon name={l.icon} className="trip-icon trip-icon--sm" />
                        {l.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="trip-day__parts">
                {PARTS.map((part) => {
                  const key = slotKey(date, part);
                  if (wedding(date, part)) {
                    if (part !== 'afternoon') return null;
                    const ours = schedule.filter((e) => e.dateIso === date);
                    const timed = ours.some((e) => e.time);
                    return (
                      <div key={key} className="trip-slot is-wedding">
                        <p className="trip-slot__label">
                          <Icon name="rings" className="trip-icon trip-icon--caps trip-icon--accent" />
                          Afternoon and evening
                        </p>
                        <div className="trip-slot__body">
                          {/* A guest who arrives that day still sees their own times: a 3 PM check-in, a flight in. */}
                          {[...fixed.byPart.afternoon, ...fixed.byPart.evening].map((l) => (
                            <FixedLine key={l.key} line={l} />
                          ))}
                          <div className="trip-wedding">
                            <p className="trip-wedding__title">The wedding</p>
                            {ours.length ? (
                              <ol className="trip-slot__events" aria-label="The wedding">
                                {ours.map((e) => (
                                  <li key={e.id} className="trip-slot__event">
                                    <span className="trip-slot__wedding">{e.name}</span>
                                    {timed ? <span>{timeText(e)}</span> : null}
                                    {e.room ? <span>{e.room}</span> : null}
                                    {e.dressCode ? <span>{`Dress code: ${e.dressCode}`}</span> : null}
                                  </li>
                                ))}
                              </ol>
                            ) : null}
                            {ours.length && !timed ? <p className="trip-wedding__note">Times to be announced</p> : null}
                            <button type="button" className="trip-wedding__more" onClick={() => onAsk('The wedding day')}>
                              Times, rooms and what to wear
                              <Icon name="arrow-right" className="trip-icon trip-icon--sm" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  const here = inSlot(date, part);
                  // Booked times and saved places, one after another in the order of the day.
                  const rows = [
                    ...fixed.byPart[part].map((l) => ({ at: Number(l.at!.slice(0, 2)) * 60 + Number(l.at!.slice(3, 5)), fixed: l, place: null })),
                    ...here.map((s) => ({ at: at.get(s.id)?.start ?? PART_START[part], fixed: null, place: s })),
                  ].sort((x, y) => x.at - y.at || (x.fixed ? -1 : 1));
                  const full = slotMinutes(here);
                  const open = adding === key && !picked;
                  const spoken = slotName(date, part);
                  return (
                    <div key={key} className={`trip-slot${over === key ? ' is-over' : ''}${picked ? ' is-choosing' : ''}${rows.length ? '' : ' is-empty'}${open ? ' is-adding' : ''}`} data-slot={key}>
                      <p className="trip-slot__label">
                        <Icon name={PART_ICON[part]} className="trip-icon trip-icon--caps trip-icon--accent" />
                        {PART_LABEL[part]}
                      </p>
                      <div className="trip-slot__body">
                        {rows.map((r) => (r.fixed ? <FixedLine key={r.fixed.key} line={r.fixed} /> : savedCard(r.place!, order, at)))}
                        {full > PART_LENGTH[part] + 15 ? (
                          <p className="trip-slot__full">
                            <Icon name="clock" className="trip-icon trip-icon--sm" />
                            {`${aboutHowLong(full)} with the travel: more than one ${part} holds. Move one to another time?`}
                          </p>
                        ) : null}
                        {picked ? (
                          here.some((x) => x.id === picked) ? (
                            <p className="trip-slot__now">It is here now</p>
                          ) : (
                            <button type="button" className="trip-slot__here" aria-label={`Move here: ${pickedPlace} to ${spoken}`} onClick={() => moveTo(picked, date, part)}>
                              <Icon name="arrow-right" className="trip-icon trip-icon--sm" />
                              Move here
                            </button>
                          )
                        ) : open ? (
                          // Adding to this part of the day, in place: the guest's own plan in their words, or ideas from our list.
                          <form
                            className="trip-slot__form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (!words.trim()) return;
                              onAddOwn({ date, part }, words);
                              setWords('');
                              setAdding(null);
                            }}
                          >
                            <label className="trip-slot__ask" htmlFor={`trip-own-${key}`}>
                              {`What are you doing on ${spoken}?`}
                            </label>
                            <input
                              id={`trip-own-${key}`}
                              className="trip-slot__input"
                              type="text"
                              value={words}
                              maxLength={80}
                              placeholder="Dinner with family, a nap, or just Busy"
                              autoComplete="off"
                              // Opened by the guest's own tap on Add for this part of the day.
                              autoFocus
                              onChange={(e) => setWords(e.target.value)}
                              onKeyDown={(e) => e.key === 'Escape' && (setAdding(null), setWords(''))}
                            />
                            <div className="trip-slot__choices">
                              <button type="submit" className="trip-add" disabled={!words.trim()}>
                                <Icon name="check" className="trip-icon trip-icon--sm" />
                                Add it
                              </button>
                              <button type="button" className="trip-link" onClick={() => (setAdding(null), setWords(''), onFind({ date, part }))}>
                                See our ideas
                              </button>
                              <button type="button" className="trip-link" onClick={() => (setAdding(null), setWords(''))}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <button type="button" className={`trip-slot__add${rows.length ? '' : ' is-free'}`} aria-label={`Add something to ${spoken}`} onClick={() => (setWords(''), setAdding(key))}>
                            <Icon name="plus" className="trip-icon trip-icon--sm" />
                            {rows.length ? 'Add something else' : 'Add something'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {addDayButton(after, 'after')}
      </div>
    </div>
  );
}
