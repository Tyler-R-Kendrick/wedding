'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

/**
 * Our Story as a ride on the 'L' (docs/design/inspo/our-story-timeline.md).
 *
 * The page is as tall as the ride; a sticky stage holds every stop at its own depth down a track, and
 * native scroll moves the camera forward through them. One rAF-throttled listener writes one custom
 * property, `--p` (the train's position in stops); CSS turns it into every card's depth, drift and
 * haze, the sleepers running under the floor, and the train on the car-card map. Scroll maps to `--p`
 * with plateaus — a short run of travel, then a longer stretch stopped at the station — and a native
 * proximity snap settles a fling on the nearest platform, so nobody has to read a memory while it moves.
 *
 * It works without script and without motion. The server renders the same ordered list flat: a
 * stations list and each stop a readable section beside its line, every stop a `#slug` anchor (an
 * assistant's citation `/our-story#love` lands on it). Script upgrades that to the ride only when the
 * guest has not asked for reduced motion and has not chosen "Read it as a list"; the page prints flat.
 *
 * Riding, it behaves like a carousel for assistive technology: the car-card map is the list of every
 * station (one tab stop, arrow keys move along it, the current one `aria-current="location"`), the
 * station at the platform is the one exposed section, and a polite live region says where the train
 * has stopped. The others stay in the page, so find-in-page still reaches their words.
 */

export type LineKey = 'red' | 'blue' | 'brown' | 'pink' | 'green' | 'orange' | 'gold';
export type StopKind = 'origin' | 'transfer' | 'station' | 'terminal';

export interface RideStop {
  slug: string;
  kind: StopKind;
  line: LineKey;
  /** "Pink Line" */
  lineName: string;
  /** Which of the two parallel tracks the stop's line runs on in the diagram. */
  track: 0 | 1;
  /** The line (and track) the train arrives on, for a transfer's dumbbell. */
  from?: { line: LineKey; track: 0 | 1 };
  /** Station name on the map and in the announcement. */
  name: string;
  /** Short date for the map, when there is one. */
  when?: string;
}

/** Share of each stop's scroll spent stopped at the station; the rest is travel to the next. */
export const DWELL = 0.6;

/** Scroll per stop as a share of the stage height: long rides get shorter hops so the line stays walkable. */
export const stepFactor = (stops: number) => Math.min(0.9, Math.max(0.55, 11 / Math.max(stops, 1)));

/** Accelerate out of the station, brake into the next: a train, not a slide. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Raw scroll in stops → the train's position, with a plateau at every station. */
export function trainPosition(raw: number, stops: number): number {
  const r = Math.min(Math.max(raw, 0), stops - 1 + DWELL);
  const i = Math.floor(r);
  const f = r - i;
  if (i >= stops - 1) return stops - 1;
  return f < DWELL ? i : i + ease((f - DWELL) / (1 - DWELL));
}

/** How long a button- or map-driven ride takes: long enough to see the stations pass, never a cut. */
export const rideDuration = (stopsTravelled: number) => Math.min(2400, 650 + 260 * Math.max(1, Math.abs(stopsTravelled)));

const noop = () => () => {};
const REDUCE = '(prefers-reduced-motion: reduce)';
const LIST_KEY = 'bd-ride-list';
const onMotionChange = (notify: () => void) => {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener('change', notify);
  window.addEventListener('beforeprint', notify);
  window.addEventListener('afterprint', notify);
  return () => {
    mq.removeEventListener('change', notify);
    window.removeEventListener('beforeprint', notify);
    window.removeEventListener('afterprint', notify);
  };
};
const readListChoice = () => {
  try {
    return window.localStorage.getItem(LIST_KEY) === '1';
  } catch {
    return false;
  }
};

/** Geometry that only changes on resize or reflow; the scroll handler never touches layout. */
interface Geometry {
  railTop: number;
  rideTop: number;
  stageH: number;
  step: number;
  railH: number;
  map: { vertical: boolean; gap: number; first: number; size: number; total: number } | null;
}

export function StoryRide({ stops, cards, lineName, intro }: { stops: RideStop[]; cards: ReactNode[]; lineName: string; intro: ReactNode }) {
  // Flat on the server, without script, with reduced motion, and while printing.
  const motionOk = useSyncExternalStore(
    onMotionChange,
    () => !window.matchMedia(REDUCE).matches && !window.matchMedia('print').matches,
    () => false,
  );
  const enhanced = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const [listChoice, setListChoice] = useState<boolean | null>(null);
  const asList = listChoice ?? (enhanced ? readListChoice() : false);
  const ride = motionOk && !asList;

  const root = useRef<HTMLElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const mapList = useRef<HTMLOListElement>(null);
  const mapViewport = useRef<HTMLDivElement>(null);
  const geo = useRef<Geometry | null>(null);
  /** A guest is swiping, pointing at or tabbing through the car card: leave its scroll alone. */
  const mapHold = useRef(false);
  const flight = useRef<{ raf: number; to: number } | null>(null);
  const reframe = useRef<() => void>(() => {});
  const [at, setAt] = useState({ index: 0, docked: true, toward: 0 });
  const [pinned, setPinned] = useState(false);
  const [announced, setAnnounced] = useState('');
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [overflow, setOverflow] = useState<{ index: number; more: boolean } | null>(null);
  const n = stops.length;
  const factor = stepFactor(n);

  const chooseList = (value: boolean) => {
    setListChoice(value);
    try {
      window.localStorage.setItem(LIST_KEY, value ? '1' : '0');
    } catch {
      /* a private window keeps the choice for this visit only */
    }
  };

  /** Scroll offset (document px) where stop `i` is docked, mid-plateau. */
  const scrollTargetFor = useCallback((i: number) => {
    const g = geo.current;
    if (!g) return null;
    return g.railTop - g.rideTop + (i + DWELL / 2) * g.step;
  }, []);

  const cancelFlight = useCallback(() => {
    if (!flight.current) return;
    window.cancelAnimationFrame(flight.current.raf);
    flight.current = null;
    document.documentElement.style.removeProperty('scroll-snap-type');
  }, []);

  /**
   * Ride to stop `i`. The scroll is driven here rather than by the browser's smooth scroll, which
   * covers any distance in ~150 ms and turns a seven-stop jump into a flicker of seven cards.
   */
  const go = useCallback(
    (i: number, instant = false) => {
      const next = Math.min(Math.max(i, 0), n - 1);
      const stop = stops[next];
      if (!stop) return;
      window.history.replaceState(window.history.state, '', `#${stop.slug}`);
      if (!ride) {
        document.getElementById(stop.slug)?.scrollIntoView({ block: 'start' });
        return;
      }
      const y = scrollTargetFor(next);
      if (y == null) return;
      cancelFlight();
      if (instant || window.matchMedia(REDUCE).matches) {
        window.scrollTo({ top: y, behavior: 'instant' });
        return;
      }
      const from = window.scrollY;
      const g = geo.current;
      const travelled = g ? Math.round((y - from) / g.step) : 1;
      const duration = rideDuration(travelled);
      const start = performance.now();
      // A proximity snap would pull every intermediate frame back to a platform.
      document.documentElement.style.setProperty('scroll-snap-type', 'none');
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const k = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        window.scrollTo({ top: from + (y - from) * k, behavior: 'instant' });
        if (t < 1) flight.current = { raf: window.requestAnimationFrame(tick), to: next };
        else {
          flight.current = null;
          document.documentElement.style.removeProperty('scroll-snap-type');
        }
      };
      flight.current = { raf: window.requestAnimationFrame(tick), to: next };
    },
    [n, ride, scrollTargetFor, stops, cancelFlight],
  );

  // The engine: geometry on resize, one custom property per frame, React state only on a new station.
  useEffect(() => {
    const el = root.current;
    const track = rail.current;
    const st = stage.current;
    if (!ride || !el || !track || !st) return;
    let frame = 0;
    let last = { index: -1, docked: false, toward: 0 };
    let lastP = 0;
    let lastPinned: boolean | null = null;

    const measure = () => {
      // The stage sits under the sticky masthead (desktop). The phone action bar is hidden while the
      // stage is pinned (html[data-ride-pinned] in ride.css), so the stage never pays for it.
      const masthead = document.querySelector<HTMLElement>('.bd-masthead');
      const rideTop = masthead && getComputedStyle(masthead).position === 'sticky' ? masthead.offsetHeight : 0;
      el.style.setProperty('--ride-top', `${rideTop}px`);
      const rect = track.getBoundingClientRect();
      const stageH = st.clientHeight;
      let map: Geometry['map'] = null;
      const list = mapList.current;
      const vp = mapViewport.current;
      if (list && vp && list.children.length > 2) {
        const a = list.children[0] as HTMLElement;
        const b = list.children[1] as HTMLElement;
        const vertical = b.offsetTop !== a.offsetTop;
        map = {
          vertical,
          gap: vertical ? b.offsetTop - a.offsetTop : b.offsetLeft - a.offsetLeft,
          first: vertical ? a.offsetTop : a.offsetLeft,
          size: vertical ? vp.clientHeight : vp.clientWidth,
          total: vertical ? vp.scrollHeight : vp.scrollWidth,
        };
        st.style.setProperty('--map-gap', `${map.gap}px`);
      }
      geo.current = { railTop: rect.top + window.scrollY, rideTop, stageH, step: stageH * factor, railH: rect.height, map };
    };

    const frameFn = () => {
      frame = 0;
      const g = geo.current;
      if (!g) return;
      const y = window.scrollY;
      const raw = (y + g.rideTop - g.railTop) / g.step;
      const p = trainPosition(raw, n);
      st.style.setProperty('--p', p.toFixed(4));
      const index = Math.round(p);
      const docked = Math.abs(p - index) < 0.002;
      // Between stations the train runs on the track of the stop it left; stopped, on the stop's own.
      const segment = Math.min(Math.floor(p + 0.0001), n - 1);
      st.style.setProperty('--train-track', String(stops[docked ? index : segment]?.track ?? 0));
      // The car card keeps the train mid-strip and the line slides under it. It is a real scroller, so
      // a guest can swipe to a far station and focus scrolls to a tabbed one; while they do, it is theirs.
      const vp = mapViewport.current;
      if (g.map && vp && !mapHold.current) {
        const { gap, first, size, total, vertical } = g.map;
        const offset = total <= size ? 0 : Math.max(0, Math.min(total - size, first + p * gap + gap / 2 - size / 2));
        if (vertical) vp.scrollTop = offset;
        else vp.scrollLeft = offset;
      }
      const isPinned = y + g.rideTop >= g.railTop - 1 && y + g.rideTop + g.stageH <= g.railTop + g.railH + 1;
      if (isPinned !== lastPinned) {
        lastPinned = isPinned;
        if (isPinned) document.documentElement.dataset.ridePinned = '';
        else delete document.documentElement.dataset.ridePinned;
        setPinned(isPinned);
      }
      // Where the train is heading: forward when scrolling down, back when scrolling up.
      const toward = docked ? index : p >= lastP ? Math.ceil(p) : Math.floor(p);
      lastP = p;
      if (index !== last.index || docked !== last.docked || toward !== last.toward) {
        if (index !== last.index) el.dataset.line = stops[index]?.line ?? 'red';
        last = { index, docked, toward };
        setAt(last);
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(frameFn);
    };
    reframe.current = schedule;
    const remeasure = () => {
      measure();
      schedule();
    };
    // A guest's own wheel, touch, pointer or scrolling key takes the train back from a button-driven
    // ride — except presses on the ride's own controls, which queue the next stop instead.
    const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
    const ownControl = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest('.bd-ride__controls, .bd-ride-map'));
    const interrupt = () => cancelFlight();
    const interruptKey = (e: globalThis.KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key) && !ownControl(e.target)) cancelFlight();
    };
    const interruptPointer = (e: Event) => {
      if (!ownControl(e.target)) cancelFlight();
    };
    remeasure();
    const ro = new ResizeObserver(remeasure);
    ro.observe(document.body);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', remeasure);
    window.addEventListener('wheel', interrupt, { passive: true });
    window.addEventListener('touchstart', interruptPointer, { passive: true });
    window.addEventListener('keydown', interruptKey);
    window.addEventListener('pointerdown', interruptPointer);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('wheel', interrupt);
      window.removeEventListener('touchstart', interruptPointer);
      window.removeEventListener('keydown', interruptKey);
      window.removeEventListener('pointerdown', interruptPointer);
      if (frame) window.cancelAnimationFrame(frame);
      cancelFlight();
      delete document.documentElement.dataset.ridePinned;
      reframe.current = () => {};
    };
  }, [ride, factor, n, stops, cancelFlight]);

  // A deep link (`/our-story#starved-rock`) lands on its station once the ride has its height.
  useEffect(() => {
    if (!ride) return;
    const jumpToHash = () => {
      const i = stops.findIndex((s) => `#${s.slug}` === window.location.hash);
      if (i >= 0) go(i, true);
    };
    jumpToHash();
    window.addEventListener('hashchange', jumpToHash);
    return () => window.removeEventListener('hashchange', jumpToHash);
  }, [ride, go, stops]);

  // Announce arrivals only once the train has settled, and only while the ride is on screen: scrolling
  // past five stations is not five interruptions, and nothing is announced from the hero.
  useEffect(() => {
    if (!ride || !at.docked || !pinned) return;
    const stop = stops[at.index];
    if (!stop) return;
    const t = window.setTimeout(() => setAnnounced(announcement(stop, stops[at.index + 1])), 600);
    return () => window.clearTimeout(t);
  }, [ride, at, pinned, stops]);

  // Only the station at the platform takes focus; links inside cards sliding past are taken out of the
  // tab order (their words stay in the page for find-in-page).
  useEffect(() => {
    const track = root.current?.querySelector('.bd-ride__track');
    if (!track) return;
    track.querySelectorAll<HTMLElement>('.bd-ride__stop').forEach((li, i) => {
      const off = ride && i !== at.index;
      li.querySelectorAll<HTMLElement>('a[href], button').forEach((f) => {
        if (off) f.setAttribute('tabindex', '-1');
        else f.removeAttribute('tabindex');
      });
    });
  }, [ride, at.index]);

  // Does the card at the platform fit its window? If not it scrolls on its own, says so, and takes focus.
  useEffect(() => {
    if (!ride) return;
    const check = () => {
      const platform = root.current?.querySelector<HTMLElement>(`.bd-ride__stop:nth-child(${at.index + 1}) .bd-ride__platform`);
      if (!platform) return;
      const over = platform.scrollHeight > platform.clientHeight + 2;
      const more = over && platform.scrollTop + platform.clientHeight < platform.scrollHeight - 8;
      setOverflow(over ? { index: at.index, more } : null);
    };
    const t = window.setTimeout(check, 50);
    window.addEventListener('resize', check);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', check);
    };
  }, [ride, at.index]);

  const onMapClick = (e: MouseEvent<HTMLAnchorElement>, i: number) => {
    if (!ride) return;
    e.preventDefault();
    go(i);
  };

  /** Arrow keys walk the map (one tab stop, like any list of choices); Enter rides there. */
  const onMapKey = (e: KeyboardEvent<HTMLAnchorElement>, i: number) => {
    const to = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = Math.min(Math.max(to, 0), n - 1);
    mapList.current?.querySelectorAll<HTMLAnchorElement>('.bd-ride-map__link')[next]?.focus();
  };
  const onMapFocus = (i: number) => {
    mapHold.current = true;
    setFocusIdx(i);
  };
  const onMapBlur = (e: FocusEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    mapHold.current = false;
    setFocusIdx(null);
    reframe.current();
  };
  const holdMap = () => {
    mapHold.current = true;
  };
  const releaseMap = () => {
    if (document.activeElement && mapList.current?.contains(document.activeElement)) return;
    mapHold.current = false;
    reframe.current();
  };

  /** Queue presses: two quick taps on Next ride two stops, not one. */
  const step = (delta: number) => go((flight.current?.to ?? at.index) + delta);

  const current = stops[at.index];
  const heading = stops[at.toward] ?? current;
  const tabbable = enhanced ? (focusIdx ?? (ride ? at.index : 0)) : null;
  const align = (i: number) => (i < 2 ? 'start' : i > n - 3 ? 'end' : undefined);

  return (
    <section
      ref={root}
      className="bd-ride"
      data-mode={ride ? 'ride' : 'flat'}
      data-enhanced={enhanced ? '' : undefined}
      data-line={stops[0]?.line}
      aria-labelledby="ride-title"
      style={{ '--stops': n, '--step-factor': factor, '--dwell': DWELL } as CSSProperties}
    >
      {intro}
      {enhanced && motionOk ? (
        <p className="bd-ride__mode">
          <button type="button" className="bd-ride__mode-btn" aria-pressed={asList} onClick={() => chooseList(!asList)}>
            {asList ? 'Ride the line instead' : 'Read it as a list'}
          </button>
        </p>
      ) : null}
      <div ref={rail} className="bd-ride__rail">
        {ride ? <RideSnaps n={n} /> : null}
        <div ref={stage} className="bd-ride__stage">
          <nav className="bd-ride-map" aria-label={`Stations on the ${lineName}`} onBlur={onMapBlur}>
            <p className="bd-ride-map__title" aria-hidden="true">
              {lineName}
            </p>
            <div
              ref={mapViewport}
              className="bd-ride-map__viewport"
              onPointerEnter={holdMap}
              onPointerLeave={releaseMap}
              onTouchStart={holdMap}
              onTouchEnd={() => window.setTimeout(releaseMap, 1500)}
            >
              <ol ref={mapList} className="bd-ride-map__list">
                {stops.map((s, i) => (
                  <li
                    key={s.slug}
                    className="bd-ride-map__stop"
                    data-kind={s.kind}
                    data-line={s.line}
                    data-from={s.from?.line}
                    data-current={ride && i === at.index ? '' : undefined}
                    data-align={align(i)}
                    style={{ '--t': s.track, '--ft': s.from?.track ?? s.track } as CSSProperties}
                  >
                    <a
                      className="bd-ride-map__link"
                      href={`#${s.slug}`}
                      aria-current={ride && i === at.index ? 'location' : undefined}
                      tabIndex={tabbable === null ? undefined : i === tabbable ? 0 : -1}
                      onClick={(e) => onMapClick(e, i)}
                      onKeyDown={(e) => onMapKey(e, i)}
                      onFocus={() => onMapFocus(i)}
                    >
                      <span className="bd-ride-map__dot" aria-hidden="true" />
                      <span className="bd-ride-map__name">
                        {s.kind === 'transfer' || s.kind === 'origin' ? <span className="bd-ride-map__line">{s.lineName}</span> : null}
                        {s.name}
                        {s.when ? <span className="bd-ride-map__when">{s.when}</span> : null}
                      </span>
                    </a>
                  </li>
                ))}
                <li className="bd-ride-map__train" aria-hidden="true" />
              </ol>
            </div>
          </nav>

          <div className="bd-ride__window">
            <div className="bd-ride__floor" aria-hidden="true" />
            <ol className="bd-ride__track" aria-label={`${lineName}, in order`}>
              {cards.map((card, i) => {
                const s = stops[i];
                if (!s) return null;
                const side = s.kind === 'station' ? (i % 2 === 0 ? 1 : -1) : 0;
                const here = ride && i === at.index;
                const over = here && overflow?.index === i;
                return (
                  <li
                    key={s.slug}
                    id={s.slug}
                    className="bd-ride__stop"
                    data-kind={s.kind}
                    data-line={s.line}
                    data-state={!ride ? undefined : here ? 'here' : i < at.index ? 'passed' : 'ahead'}
                    data-near={ride && Math.abs(i - at.index) <= 2 ? '' : undefined}
                    data-overflow={over ? (overflow?.more ? 'more' : 'end') : undefined}
                    style={{ '--i': i, '--side': side } as CSSProperties}
                    // Riding, the station at the platform is the one exposed section; the scenery sliding
                    // past is hidden from assistive technology and out of the tab order (effect above).
                    aria-hidden={ride && !here ? true : undefined}
                  >
                    <div
                      className="bd-ride__platform"
                      {...(over ? { tabIndex: 0, role: 'group', 'aria-labelledby': `${s.slug}-title` } : {})}
                      onScroll={
                        over
                          ? (e) => {
                              const p = e.currentTarget;
                              const more = p.scrollTop + p.clientHeight < p.scrollHeight - 8;
                              if (more !== overflow?.more) setOverflow({ index: i, more });
                            }
                          : undefined
                      }
                    >
                      {card}
                    </div>
                    {over && overflow?.more ? (
                      <span className="bd-ride__more" aria-hidden="true">
                        More <span className="bd-ride__more-arrow">↓</span>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            {ride && current ? (
              <div className="bd-ride__sign" data-line={at.docked ? current.line : (heading?.line ?? current.line)}>
                <p className="bd-ride__sign-text" aria-hidden="true">
                  <span className="bd-ride__sign-kicker">
                    <span className="bd-ride__sign-bullet" />
                    {at.docked ? (current.kind === 'terminal' ? 'End of the line' : 'This is') : 'Next stop'}
                  </span>
                  <span className="bd-ride__sign-name">{at.docked ? current.name : heading?.name}</span>
                </p>
                <p className="sr-only" aria-live="polite">
                  {announced}
                </p>
                <div className="bd-ride__controls">
                  <button type="button" className="bd-ride__btn" onClick={() => step(-1)} disabled={at.index === 0}>
                    <span aria-hidden="true">←</span>
                    <span className="bd-ride__btn-label">Back a stop</span>
                  </button>
                  <button type="button" className="bd-ride__btn bd-ride__btn--next" onClick={() => step(1)} disabled={at.index >= n - 1}>
                    <span className="bd-ride__btn-label">Next stop</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/** One snap target per platform, mid-plateau, so a fling settles on a station rather than between two. */
function RideSnaps({ n }: { n: number }) {
  return (
    <div className="bd-ride__snaps" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="bd-ride__snap" style={{ '--i': i } as CSSProperties} />
      ))}
    </div>
  );
}

/** What the car would say: "This is Starved Rock. Transfer to the Green Line." */
function announcement(stop: RideStop, next: RideStop | undefined): string {
  if (stop.kind === 'terminal') return `This is ${stop.name}, the end of the line.`;
  const here = stop.kind === 'transfer' || stop.kind === 'origin' ? `This is the ${stop.lineName}: ${stop.name}.` : `This is ${stop.name}.`;
  return next && next.line !== stop.line && next.kind !== 'terminal' ? `${here} Next, transfer to the ${next.lineName}.` : here;
}
