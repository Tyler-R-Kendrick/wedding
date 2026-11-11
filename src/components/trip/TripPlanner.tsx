'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { downloadIcs, TripPlannerProvider, TripRenderer, type TripAction, type TripHotel } from '@/components/trip/openui';
import {
  buildIcs,
  calendarModel,
  compose,
  DAY_NAME,
  dateLabel,
  DAYS,
  draftPlan,
  isWeddingTime,
  mergeWritten,
  PARTS,
  planEntries,
  safeSlot,
  tripEntries,
  weddingEntries,
  weekendDate,
  writerPrompt,
  type CalendarEntry,
  type Day,
  type Part,
  type Plan,
  type PlannerPlace,
  type SavedItem,
  type StayFacts,
  type TripItemInput,
  type WeddingEventInput,
} from '@/domain/trip-planner';
import { embed, ensureLocal, getLocalModels, holdLocal, writeLines } from '@/lib/ai/local';
import { speechSupport, startDictation, type Dictation, type DictationError } from '@/lib/speech';
import { Icon, type IconName } from '@/themes/shared/icons';
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

export type PlannerActions = {
  save(input: { placeId: string; day: Day; part: Part }): Promise<{ ok: true; itemId: string } | { ok: false; message: string }>;
  remove(input: { placeId: string }): Promise<{ ok: true } | { ok: false; message: string }>;
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
  /** Absent: the weekend is kept in memory only. */
  actions?: PlannerActions;
};

type Turn = { id: number; request: string; program: string; waiting: boolean; streaming: boolean };

export const STARTERS: { label: string; hint: string; request: string; icon: IconName }[] = [
  { label: 'A free Saturday morning', hint: 'Before the wedding', request: 'A free Saturday morning before the wedding', icon: 'sunrise' },
  { label: 'I have two hours', hint: 'Fit it to the time', request: 'I have two hours', icon: 'clock' },
  { label: 'For the architecture people', hint: 'Buildings worth the walk', request: 'For the architecture people', icon: 'landmark' },
  { label: 'With kids', hint: 'Things they will love', request: 'Something to do with kids', icon: 'balloon' },
  { label: 'Where should we get dinner?', hint: 'In the hotel or out', request: 'Where should we get dinner?', icon: 'dinner' },
  { label: 'Plan my whole weekend', hint: 'Friday to Sunday', request: 'Plan my whole weekend', icon: 'calendar' },
];

const PART_LABEL: Record<Part, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const PART_ICON: Record<Part, IconName> = { morning: 'sunrise', afternoon: 'sun', evening: 'moon' };
const SLOTS = DAYS.flatMap((day) => PARTS.filter((part) => !isWeddingTime(day, part)).map((part) => ({ day, part, value: `${day}-${part}`, label: `${DAY_NAME[day]} ${part}` })));
const CONFIRMED_KEY = 'your-trip:weekend-set';
const ENOUGH = 3;
/** How long a request waits for the matcher to install before answering without it. */
const MATCH_WAIT_MS = 6000;
const NO_WORDS = new Set<Plan['shape']>(['calendar', 'stay', 'arrive']);
const SAVE_FAILED = 'We could not save that just now. Please try again in a moment.';
const REMOVE_FAILED = 'We could not take that out just now. Please try again in a moment.';
const TOAST_MS = 5000;

const SPEECH_ERROR: Record<DictationError, string> = {
  'not-allowed': 'We could not use your microphone. You can type instead.',
  'no-speech': 'We did not catch that. Try again, or type instead.',
  unavailable: 'Speaking is not available here. You can type instead.',
  failed: 'That did not work. Please type instead.',
};

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "My weekend is set", remembered for the browser session (the server render never knows it). */
const confirmedStore = (() => {
  const listeners = new Set<() => void>();
  let memory = false;
  const read = () => {
    try {
      return sessionStorage.getItem(CONFIRMED_KEY) === '1';
    } catch {
      return memory;
    }
  };
  return {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get: read,
    set(on: boolean) {
      memory = on;
      try {
        if (on) sessionStorage.setItem(CONFIRMED_KEY, '1');
        else sessionStorage.removeItem(CONFIRMED_KEY);
      } catch {
        // Private windows and blocked storage: the confirmation lasts for this page view only.
      }
      for (const fn of listeners) fn();
    },
  };
})();

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

async function matchScores(request: string, places: PlannerPlace[], signal: AbortSignal): Promise<Map<string, number> | null> {
  const state = getLocalModels().matcher.state;
  if (state === 'unsupported') return null;
  // The guest's request is the first use, so it may start the install (or try again after a failed
  // background one: once per request); the answer never waits long for it.
  const ready = state === 'ready' || (await Promise.race([ensureLocal('matcher', { userGesture: true }).catch(() => false), wait(MATCH_WAIT_MS, signal)]));
  if (!ready || signal.aborted) return null;
  const vectors = await placeVectors(places, signal);
  const query = vectors ? (await embed([request], { query: true, signal }))?.[0] : null;
  if (!vectors || !query || signal.aborted) return null;
  return new Map(places.map((p, i) => [p.id, vectors[i]!.reduce((sum, v, k) => sum + v * (query[k] ?? 0), 0)]));
}

export function TripPlanner({ places, saved: initialSaved, bookings, events, hotel, stay, actions }: TripPlannerProps) {
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const [saved, setSaved] = useState<PlannerSaved[]>(() => initialSaved.filter((s) => byId.has(s.id) || s.name));
  // The weekend as of the last change, for handlers that run between renders; every write updates both.
  const savedRef = useRef(saved);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [tab, setTab] = useState<'ask' | 'weekend'>('ask');
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<{ text: string; key: number; open: boolean } | null>(null);
  // Pointed at or focused: a message is never taken away from under the guest.
  const [toastHeld, setToastHeld] = useState(false);
  const confirmed = useSyncExternalStore(confirmedStore.subscribe, confirmedStore.get, () => false);
  const [speech, setSpeech] = useState<'none' | 'ready' | 'listening'>('none');
  const [speechNote, setSpeechNote] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const dictation = useRef<{ run: Dictation; abort: AbortController } | null>(null);
  const touched = useRef(new Set<number>());
  /** Each place's changes, sent one after another. */
  const chains = useRef(new Map<string, Promise<boolean>>());
  const nextId = useRef(1);
  const lastPress = useRef<DOMRect | null>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
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
  const toastAction = !!toast?.open && tab !== 'weekend';
  useEffect(() => {
    if (!toast || toastAction || toastHeld) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, toastAction, toastHeld]);

  const say = useCallback((text: string, open = false) => {
    setToastHeld(false);
    setToast({ text, key: Date.now(), open });
  }, []);
  const closeToast = useCallback(() => {
    setToastHeld(false);
    setToast(null);
  }, []);
  const patch = useCallback((id: number, next: Partial<Turn>) => setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...next } : t))), []);

  const calendarEntries = useCallback((): CalendarEntry[] => {
    const origin = typeof location === 'undefined' ? undefined : location.origin;
    return [...weddingEntries(events), ...planEntries(savedRef.current, byId, origin ? { origin } : {}), ...tripEntries(bookings)];
  }, [events, bookings, byId]);

  const composeFor = useCallback(
    (plan: Plan) => compose(plan, { places: byId, saved: savedRef.current, ...(plan.shape === 'calendar' ? { calendar: calendarModel(calendarEntries()) } : {}) }),
    [byId, calendarEntries],
  );

  /** The better answer, while the guest has not started using the first one. */
  const upgrade = useCallback(
    async (id: number, request: string, first: Plan, signal: AbortSignal) => {
      const apply = (plan: Plan, streaming: boolean) => {
        if (signal.aborted || touched.current.has(id)) return false;
        patch(id, { program: composeFor(plan), streaming });
        return true;
      };
      let current = first;
      const scores = await matchScores(request, places, signal).catch(() => null);
      if (scores && !signal.aborted && !touched.current.has(id)) {
        const better = draftPlan({ request, places, saved: savedRef.current, scores });
        if (apply(better, false)) current = better;
      }
      if (signal.aborted || touched.current.has(id) || NO_WORDS.has(current.shape)) return;
      const base = current;
      const { system, prompt } = writerPrompt({ request, draft: base, places });
      const text = await writeLines({ system, prompt, signal, onText: (t) => void apply(mergeWritten(base, t, places), true) }).catch(() => null);
      if (text) apply(mergeWritten(base, text, places, { complete: true }), false);
    },
    [places, composeFor, patch],
  );

  const send = useCallback(
    (raw: string) => {
      const request = raw.trim();
      if (!request) return;
      ctl.current?.abort();
      const ac = new AbortController();
      ctl.current = ac;
      const id = nextId.current++;
      const plan = draftPlan({ request, places, saved: savedRef.current });
      const quiet = NO_WORDS.has(plan.shape);
      setTurns((all) => [...all.map((t) => (t.waiting || t.streaming ? { ...t, waiting: false, streaming: false } : t)), { id, request, program: composeFor(plan), waiting: !quiet, streaming: false }]);
      setDraft('');
      setTab('ask');
      requestAnimationFrame(() => threadEnd.current?.scrollIntoView?.({ block: 'end', behavior: reduced() ? 'auto' : 'smooth' }));
      if (quiet) return;
      void upgrade(id, request, plan, ac.signal).finally(() => {
        if (ctl.current === ac) patch(id, { waiting: false, streaming: false });
      });
    },
    [places, composeFor, upgrade, patch],
  );

  const startOver = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    touched.current.clear();
    setTurns([]);
    setDraft('');
    askRef.current?.focus();
  }, []);

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
        if (r.ok) return true;
        update((all) => {
          const now = all.find((s) => s.id === id) ?? null;
          const same = now && after ? now.day === after.day && now.part === after.part : now === after;
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

  const saveTo = useCallback(
    (id: string, name: string, day: Day, part: Part) => {
      const was = savedRef.current.find((s) => s.id === id);
      return change(id, { ...(was ?? { name }), id, name: was?.name ?? name, day, part }, () => actions!.save({ placeId: id, day, part }));
    },
    [actions, change],
  );

  const add = useCallback(
    (id: string, day?: Day, part?: Part) => {
      const place = byId.get(id);
      if (!place) return;
      const slot = safeSlot(day ?? 'sat', part ?? 'morning');
      fly();
      say(`${place.name} is in your weekend, ${DAY_NAME[slot.day]} ${slot.part}.`, true);
      void saveTo(id, place.name, slot.day, slot.part);
    },
    [byId, saveTo, fly, say],
  );

  const move = useCallback(
    (id: string, day: Day, part: Part) => {
      if (isWeddingTime(day, part)) return;
      const item = savedRef.current.find((s) => s.id === id);
      if (!item || (item.day === day && item.part === part)) return;
      void saveTo(id, item.name, day, part);
    },
    [saveTo],
  );

  const remove = useCallback(
    (id: string) => {
      if (!savedRef.current.some((s) => s.id === id)) return;
      void change(id, null, () => actions!.remove({ placeId: id }));
    },
    [actions, change],
  );

  /** A whole-weekend plan: adds what is new and moves what is elsewhere; never takes a place out. */
  const replaceWeekend = useCallback(
    (items: { id: string; day: Day; part: Part }[]) => {
      const wanted = items.filter((i) => byId.has(i.id)).map((i) => ({ ...i, ...safeSlot(i.day, i.part) }));
      const work = wanted
        .filter((w) => {
          const was = savedRef.current.find((s) => s.id === w.id);
          return !was || was.day !== w.day || was.part !== w.part;
        })
        .map((w) => saveTo(w.id, byId.get(w.id)!.name, w.day, w.part));
      void Promise.all(work).then((done) => done.every(Boolean) && say('Your weekend is set out on the board.', true));
    },
    [byId, saveTo, say],
  );

  const exportCalendar = useCallback(() => {
    const text = buildIcs({ items: calendarEntries(), now: new Date(), uidDomain: typeof location === 'undefined' ? 'wedding.local' : location.host || 'wedding.local' });
    downloadIcs(text, 'our-wedding-weekend.ics');
    say('Your calendar file is saved. Open it to add the weekend to your calendar.');
  }, [calendarEntries, say]);

  const confirm = useCallback(() => {
    confirmedStore.set(true);
    send('My weekend is set');
  }, [send]);

  const onAction = useCallback(
    (action: TripAction) => {
      switch (action.type) {
        case 'AddToWeekend':
          return add(action.id, action.day, action.part);
        case 'RemoveFromWeekend':
          return remove(action.id);
        case 'SetWeekend':
          return replaceWeekend(action.items);
        case 'ConfirmWeekend':
          return confirm();
        case 'ExportCalendar':
          return exportCalendar();
        case 'Ask':
          return send(action.message);
      }
    },
    [add, remove, replaceWeekend, confirm, exportCalendar, send],
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

  const savedItems: SavedItem[] = saved;
  const listening = speech === 'listening';
  const openWeekend = tab === 'weekend' ? undefined : () => (setTab('weekend'), closeToast());

  return (
    <TripPlannerProvider places={byId} saved={savedItems} hotel={hotel} {...(stay ? { stay } : {})} onAction={onAction}>
      <div className="trip-planner" onPointerDownCapture={(e) => (lastPress.current = (e.target as Element).closest?.('button')?.getBoundingClientRect() ?? null)}>
        <div className="trip-tabs" role="tablist" aria-label="Planner">
          <button type="button" role="tab" id="trip-tab-ask" aria-selected={tab === 'ask'} aria-controls="trip-panel-ask" tabIndex={tab === 'ask' ? 0 : -1} className="trip-tab" onClick={() => setTab('ask')} onKeyDown={(e) => e.key === 'ArrowRight' && (setTab('weekend'), tabRef.current?.focus())}>
            <Icon name="chat" className="trip-icon trip-tab__icon" />
            Ask us
          </button>
          <button ref={tabRef} type="button" role="tab" id="trip-tab-weekend" aria-selected={tab === 'weekend'} aria-controls="trip-panel-weekend" tabIndex={tab === 'weekend' ? 0 : -1} className="trip-tab" onClick={() => setTab('weekend')} onKeyDown={(e) => e.key === 'ArrowLeft' && (setTab('ask'), document.getElementById('trip-tab-ask')?.focus())}>
            <Icon name="heart" filled={saved.length > 0} className="trip-icon trip-tab__icon" />
            My weekend
            {saved.length ? (
              <span className="trip-tab__count" key={saved.length}>
                {saved.length}
                <span className="sr-only"> saved</span>
              </span>
            ) : null}
          </button>
        </div>

        <div id="trip-panel-ask" role="tabpanel" aria-labelledby="trip-tab-ask" hidden={tab !== 'ask'} className="trip-panel">
          {turns.length === 0 ? (
            <div className="trip-starters" role="group" aria-label="Ideas to start with">
              {STARTERS.map((s) => (
                <button key={s.label} type="button" className="trip-starter" onClick={() => send(s.request)}>
                  <Icon name={s.icon} className="trip-starter__icon" />
                  <span className="trip-starter__label">{s.label}</span>
                  <span className="trip-starter__hint">{s.hint}</span>
                </button>
              ))}
            </div>
          ) : (
            <ol className="trip-thread" aria-label="Your questions and our answers">
              {turns.map((t) => (
                <li key={t.id} className="trip-turn" aria-busy={t.waiting || t.streaming}>
                  <p className="trip-turn__asked">
                    <span className="sr-only">You asked: </span>
                    {t.request}
                  </p>
                  {t.waiting ? (
                    <p className="trip-typing" role="status">
                      <span className="sr-only">Writing back</span>
                      <span className="trip-typing__dot" aria-hidden="true" />
                      <span className="trip-typing__dot" aria-hidden="true" />
                      <span className="trip-typing__dot" aria-hidden="true" />
                    </p>
                  ) : null}
                  <div className="trip-turn__answer" onPointerDown={() => touched.current.add(t.id)} onKeyDown={() => touched.current.add(t.id)} onFocusCapture={() => touched.current.add(t.id)}>
                    <TripRenderer response={t.program} isStreaming={t.streaming} />
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div ref={threadEnd} className="trip-thread__end" aria-hidden="true" />

          <form className="trip-ask" onSubmit={submit}>
            <div className="trip-toast trip-toast--ask" role="status" aria-live="polite">
              {toast && tab === 'ask' ? <Toast toast={toast} onOpen={openWeekend} onClose={closeToast} onHold={setToastHeld} /> : null}
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
          </form>
          {turns.length ? (
            <button type="button" className="trip-reset" onClick={startOver}>
              <Icon name="restart" className="trip-icon" />
              Start over
            </button>
          ) : null}
        </div>

        <div id="trip-panel-weekend" role="tabpanel" aria-labelledby="trip-tab-weekend" hidden={tab !== 'weekend'} className="trip-panel">
          <Board saved={saved} byId={byId} confirmed={confirmed} onMove={move} onRemove={remove} onConfirm={confirm} onAsk={send} persist={!!actions} />
        </div>

        <div className="trip-toast trip-toast--float" role="status" aria-live="polite">
          {toast && tab !== 'ask' ? <Toast toast={toast} onOpen={openWeekend} onClose={closeToast} onHold={setToastHeld} /> : null}
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
  toast: { text: string; key: number; open: boolean };
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
      {toast.open && onOpen ? (
        <button type="button" className="trip-toast__open" onClick={onOpen}>
          See my weekend
          <Icon name="arrow-right" className="trip-icon trip-icon--sm" />
        </button>
      ) : null}
      <button type="button" className="trip-round trip-toast__close" aria-label="Close" title="Close" onClick={onClose}>
        <Icon name="close" className="trip-icon" />
      </button>
    </div>
  );
}

/** The three days, each in parts; Saturday afternoon and evening belong to the wedding. */
function Board({
  saved,
  byId,
  confirmed,
  onMove,
  onRemove,
  onConfirm,
  onAsk,
  persist,
}: {
  saved: PlannerSaved[];
  byId: ReadonlyMap<string, PlannerPlace>;
  confirmed: boolean;
  onMove: (id: string, day: Day, part: Part) => void;
  onRemove: (id: string) => void;
  onConfirm: () => void;
  onAsk: (request: string) => void;
  persist: boolean;
}) {
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  // A moved card is drawn again in its new slot, and a removed one is gone: keyboard focus follows
  // to the moved card's Move list, or to the next card that day (else the day's heading).
  const focusNext = useRef<{ kind: 'move'; id: string } | { kind: 'remove'; day: Day; next: string | null } | null>(null);
  useEffect(() => {
    const want = focusNext.current;
    focusNext.current = null;
    const root = boardRef.current;
    if (!want || !root) return;
    const card = (id: string) => root.querySelector<HTMLElement>(`[data-saved-id="${id}"]`);
    if (want.kind === 'move') card(want.id)?.querySelector<HTMLElement>('.trip-saved__select')?.focus();
    else ((want.next ? card(want.next)?.querySelector<HTMLElement>('.trip-saved__remove') : null) ?? document.getElementById(`trip-day-${want.day}`))?.focus();
  }, [saved]);
  const moveFrom = (s: PlannerSaved, day: Day, part: Part) => {
    if (s.day !== day || s.part !== part) focusNext.current = { kind: 'move', id: s.id };
    onMove(s.id, day, part);
  };
  const removeFrom = (s: PlannerSaved) => {
    const thatDay = PARTS.flatMap((part) => saved.filter((x) => x.day === s.day && x.part === part));
    focusNext.current = { kind: 'remove', day: s.day, next: thatDay[thatDay.indexOf(s) + 1]?.id ?? null };
    onRemove(s.id);
  };
  const drop = (e: DragEvent, day: Day, part: Part) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragging;
    if (id) onMove(id, day, part);
    setOver(null);
    setDragging(null);
  };
  const enough = saved.length >= ENOUGH;
  return (
    <div className="trip-board" ref={boardRef}>
      <div className="trip-board__bar">
        <p className="trip-text trip-text--md">
          {saved.length
            ? `Move a place to another part of the weekend by dragging it, or choose a new time from its list.${persist ? '' : ' This weekend is kept on this page only.'}`
            : 'Nothing saved yet. Ask us for ideas, then tap the heart on anything you like.'}
        </p>
        <div className="trip-board__actions">
          <button type="button" className="bd-btn bd-btn--primary trip-button trip-button--icon" disabled={!enough} onClick={onConfirm} aria-describedby="trip-confirm-hint">
            <Icon name={confirmed ? 'calendar' : 'check'} className="trip-icon" />
            <span>{confirmed ? 'Show my calendar' : 'Confirm my weekend'}</span>
          </button>
          <p id="trip-confirm-hint" className="trip-caption">
            {enough ? (confirmed ? 'Your weekend is set. You can still change it here.' : 'We will show it as a calendar you can save.') : `Save ${ENOUGH - saved.length} more ${ENOUGH - saved.length === 1 ? 'place' : 'places'} to see it as a calendar.`}
          </p>
          {!saved.length ? (
            <button type="button" className="trip-chip" onClick={() => onAsk('Plan my whole weekend')}>
              Plan my whole weekend
            </button>
          ) : null}
        </div>
      </div>
      <div className="trip-days">
        {DAYS.map((day) => (
          <section key={day} className="trip-day" aria-labelledby={`trip-day-${day}`}>
            <h3 id={`trip-day-${day}`} className="trip-title trip-title--md" tabIndex={-1}>
              {dateLabel(weekendDate(day))}
            </h3>
            {PARTS.map((part) => {
              const key = `${day}-${part}`;
              if (isWeddingTime(day, part)) {
                return part === 'afternoon' ? (
                  <div key={key} className="trip-slot is-wedding">
                    <p className="trip-slot__label">
                      <Icon name="rings" className="trip-icon trip-icon--caps" />
                      Afternoon and evening
                    </p>
                    <p className="trip-slot__wedding">The wedding</p>
                  </div>
                ) : null;
              }
              const here = saved.filter((s) => s.day === day && s.part === part);
              return (
                <div
                  key={key}
                  className={`trip-slot${over === key ? ' is-over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(key);
                  }}
                  onDragLeave={() => setOver((o) => (o === key ? null : o))}
                  onDrop={(e) => drop(e, day, part)}
                >
                  <p className="trip-slot__label">
                    <Icon name={PART_ICON[part]} className="trip-icon trip-icon--caps trip-icon--accent" />
                    {PART_LABEL[part]}
                  </p>
                  {here.length === 0 ? <p className="trip-slot__empty">Free</p> : null}
                  {here.map((s) => {
                    const place = byId.get(s.id);
                    const name = place?.name ?? s.name;
                    return (
                      <article
                        key={s.id}
                        data-saved-id={s.id}
                        className={`trip-saved${dragging === s.id ? ' is-dragging' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', s.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDragging(s.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                      >
                        <Icon name="grip" className="trip-saved__grip" strokeWidth="3" />
                        <h4 className="trip-saved__name">{place ? <a className="bd-link" href={place.href}>{name}</a> : name}</h4>
                        <button type="button" className="trip-round trip-saved__remove" aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={() => removeFrom(s)}>
                          <Icon name="trash" className="trip-icon" />
                        </button>
                        <div className="trip-saved__tools">
                          <label className="trip-saved__move" title="Move to another time">
                            <Icon name="calendar" className="trip-icon" />
                            <select
                              className="trip-saved__select"
                              aria-label={`Move ${name} to`}
                              value={`${s.day}-${s.part}`}
                              onChange={(e) => {
                                const slot = SLOTS.find((x) => x.value === e.target.value);
                                if (slot) moveFrom(s, slot.day, slot.part);
                              }}
                            >
                              {SLOTS.map((x) => (
                                <option key={x.value} value={x.value}>
                                  {x.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
