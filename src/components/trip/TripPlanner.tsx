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
import { embed, ensureLocal, getLocalModels, writeLines } from '@/lib/ai/local';
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
 * the weekend lives in memory only.
 */

/** A saved place as the board holds it: the trip item it is stored as, once there is one. */
export type PlannerSaved = SavedItem & { name: string; itemId?: string | null };

export type PlannerActions = {
  save(input: { placeId: string; day: Day; part: Part; itemId?: string | null }): Promise<{ ok: true; itemId: string } | { ok: false; message: string }>;
  remove(input: { itemId: string }): Promise<{ ok: true } | { ok: false; message: string }>;
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
  if (state === 'unsupported' || state === 'failed') return null;
  // The guest's request is the first use, so it may start the install; the answer never waits long for it.
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
  const confirmed = useSyncExternalStore(confirmedStore.subscribe, confirmedStore.get, () => false);
  const [speech, setSpeech] = useState<'none' | 'ready' | 'listening'>('none');
  const [speechNote, setSpeechNote] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const dictation = useRef<{ run: Dictation; abort: AbortController } | null>(null);
  const touched = useRef(new Set<number>());
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
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const say = useCallback((text: string, open = false) => setToast({ text, key: Date.now(), open }), []);
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

  /** Optimistic: the board changes now; a failed save puts it back and says so. */
  const commit = useCallback(
    async (next: PlannerSaved[], work: (() => Promise<string | null>)[]) => {
      const before = savedRef.current;
      setSaved(next);
      savedRef.current = next;
      if (!actions) return true;
      for (const step of work) {
        const failed = await step();
        if (failed) {
          setSaved(before);
          savedRef.current = before;
          say(failed);
          return false;
        }
      }
      return true;
    },
    [actions, say],
  );

  const persistSave = useCallback(
    (placeId: string, day: Day, part: Part) => async () => {
      if (!actions) return null;
      const existing = savedRef.current.find((s) => s.id === placeId);
      const r = await actions.save({ placeId, day, part, itemId: existing?.itemId ?? null }).catch(() => ({ ok: false as const, message: 'We could not save that just now. Please try again in a moment.' }));
      if (!r.ok) return r.message;
      setSaved((all) => {
        const next = all.map((s) => (s.id === placeId ? { ...s, itemId: r.itemId } : s));
        savedRef.current = next;
        return next;
      });
      return null;
    },
    [actions],
  );

  const persistRemove = useCallback(
    (item: PlannerSaved | undefined) => async () => {
      if (!actions || !item?.itemId) return null;
      const r = await actions.remove({ itemId: item.itemId }).catch(() => ({ ok: false as const, message: 'We could not take that out just now. Please try again in a moment.' }));
      return r.ok ? null : r.message;
    },
    [actions],
  );

  const add = useCallback(
    (id: string, day?: Day, part?: Part) => {
      const place = byId.get(id);
      if (!place) return;
      const slot = safeSlot(day ?? 'sat', part ?? 'morning');
      const existing = savedRef.current.find((s) => s.id === id);
      const next = existing ? savedRef.current.map((s) => (s.id === id ? { ...s, ...slot } : s)) : [...savedRef.current, { id, ...slot, name: place.name }];
      fly();
      say(`${place.name} is in your weekend, ${DAY_NAME[slot.day]} ${slot.part}.`, true);
      void commit(next, [persistSave(id, slot.day, slot.part)]);
    },
    [byId, commit, persistSave, fly, say],
  );

  const move = useCallback(
    (id: string, day: Day, part: Part) => {
      if (isWeddingTime(day, part)) return;
      const item = savedRef.current.find((s) => s.id === id);
      if (!item || (item.day === day && item.part === part)) return;
      void commit(
        savedRef.current.map((s) => (s.id === id ? { ...s, day, part } : s)),
        [persistSave(id, day, part)],
      );
    },
    [commit, persistSave],
  );

  const remove = useCallback(
    (id: string) => {
      const item = savedRef.current.find((s) => s.id === id);
      if (!item) return;
      void commit(
        savedRef.current.filter((s) => s.id !== id),
        [persistRemove(item)],
      );
    },
    [commit, persistRemove],
  );

  const replaceWeekend = useCallback(
    (items: { id: string; day: Day; part: Part }[]) => {
      const wanted = items.filter((i) => byId.has(i.id)).map((i) => ({ ...i, ...safeSlot(i.day, i.part) }));
      const current = savedRef.current;
      const next: PlannerSaved[] = wanted.map((w) => ({ ...(current.find((s) => s.id === w.id) ?? { name: byId.get(w.id)!.name }), id: w.id, day: w.day, part: w.part }));
      const work = [
        ...current.filter((s) => !wanted.some((w) => w.id === s.id)).map((s) => persistRemove(s)),
        ...wanted.filter((w) => {
          const was = current.find((s) => s.id === w.id);
          return !was || was.day !== w.day || was.part !== w.part || !was.itemId;
        }).map((w) => persistSave(w.id, w.day, w.part)),
      ];
      void commit(next, work).then((ok) => ok && say('Your weekend is set out on the board.', true));
    },
    [byId, commit, persistRemove, persistSave, say],
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
  const openWeekend = tab === 'weekend' ? undefined : () => (setTab('weekend'), setToast(null));

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
              {toast && tab === 'ask' ? <Toast toast={toast} onOpen={openWeekend} onClose={() => setToast(null)} /> : null}
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
          {toast && tab !== 'ask' ? <Toast toast={toast} onOpen={openWeekend} onClose={() => setToast(null)} /> : null}
        </div>
      </div>
    </TripPlannerProvider>
  );
}

/** A short note after a change: what happened, where to see it, and a way to close it. */
function Toast({ toast, onOpen, onClose }: { toast: { text: string; key: number; open: boolean }; onOpen: (() => void) | undefined; onClose: () => void }) {
  return (
    <div className="trip-toast__box" key={toast.key}>
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
  const drop = (e: DragEvent, day: Day, part: Part) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragging;
    if (id) onMove(id, day, part);
    setOver(null);
    setDragging(null);
  };
  const enough = saved.length >= ENOUGH;
  return (
    <div className="trip-board">
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
            <h3 id={`trip-day-${day}`} className="trip-title trip-title--md">
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
                        <button type="button" className="trip-round trip-saved__remove" aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={() => onRemove(s.id)}>
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
                                if (slot) onMove(s.id, slot.day, slot.part);
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
