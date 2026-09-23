'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

/**
 * Our Story as a ride on the 'L' (docs/design/inspo/our-story-timeline.md).
 *
 * The page is as tall as the ride; a sticky ivory stage holds the line and one moment at a time, and
 * native scroll moves the train along the line. One rAF-throttled listener writes the train's position
 * (`--p`, on the train) and each nearby moment's distance from it (`--d`, on that moment); CSS turns
 * those into the train on the line and each moment's drift and fade. Scroll maps to `--p` with
 * plateaus — a short run of travel, then a longer stretch stopped at the station — and when scrolling
 * stops between two stations the train rolls on to the nearer platform, so nobody has to read a memory
 * while it moves. Stopped, the moment is the whole stage: its words first, its picture beside or under
 * them, nothing behind.
 *
 * The line is a CTA car card laid horizontally, as it is above the doors: a fat line in each chapter's
 * colour, a white circle per station, a wide ring where a chapter begins, the square Loop at the end,
 * and the station names angled above it. On a phone (or a short window) the strip keeps the train
 * mid-screen, the line slides under it, and only the current name is written out.
 *
 * It works without script and without motion. The server renders the same ordered list flat: the
 * line, then each stop a readable section, every stop a `#slug` anchor (an assistant's citation
 * `/our-story#love` lands on it). Script upgrades that to the ride only when the guest has not asked
 * for reduced motion and has not chosen "Read it as a list"; the page prints flat.
 *
 * Riding, it behaves like a carousel for assistive technology: the car card is the list of every
 * station (one tab stop, arrow keys move along it, the current one `aria-current="location"`), the
 * station at the platform is the one exposed section, and a polite live region says where the train
 * has stopped. The others stay in the page, so find-in-page still reaches their words.
 */

export type LineKey = 'red' | 'blue' | 'brown' | 'pink' | 'green' | 'orange' | 'gold';
export type StopKind = 'origin' | 'transfer' | 'station' | 'terminal';

export interface RideStop {
  slug: string;
  kind: StopKind;
  /** The chapter's colour on the line. Never named on the page: the colour is the way-finding. */
  line: LineKey;
  /** Station name on the line and in the announcement. */
  name: string;
  /** Short date for the line, when there is one. */
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

/** Inverse of the ease: how far through a run the train is when it has covered `y` of it. */
const easeInverse = (y: number) => (y < 0.5 ? Math.sqrt(y / 2) : 1 - Math.sqrt(2 * (1 - y)) / 2);

/**
 * The raw scroll (in stops) that puts the train at `p`: the start of a station's plateau when it is
 * exactly at a station, the point along the run otherwise. `trainPosition(rawScrollFor(p)) === p`.
 */
export function rawScrollFor(p: number): number {
  const i = Math.floor(p);
  const f = p - i;
  return f < 1e-6 ? i : i + DWELL + easeInverse(f) * (1 - DWELL);
}

/** Ease for a button ride, applied to the train itself: it pulls away and brakes, and never sits still. */
const glide = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

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
  map: { gap: number; first: number; size: number; total: number } | null;
}

export function StoryRide({ stops, cards, lineName, title }: { stops: RideStop[]; cards: ReactNode[]; lineName: string; title: ReactNode }) {
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
  /** A jump of more than one stop runs express: only the moment you leave and the one you reach are shown. */
  const express = useRef<{ from: number; to: number } | null>(null);
  const reframe = useRef<() => void>(() => {});
  /** Draw the ride for the current scroll position now, in this frame (a button ride calls it after scrolling). */
  const renderNow = useRef<() => void>(() => {});
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

  const endExpress = useCallback(() => {
    const ex = express.current;
    if (!ex) return;
    express.current = null;
    delete stage.current?.dataset.express;
    root.current?.querySelectorAll<HTMLElement>('.bd-ride__stop[data-express-end]').forEach((li) => delete li.dataset.expressEnd);
  }, []);

  const cancelFlight = useCallback(() => {
    if (!flight.current) return;
    window.cancelAnimationFrame(flight.current.raf);
    flight.current = null;
    endExpress();
    renderNow.current();
  }, [endExpress]);

  /**
   * Ride to stop `i`. The scroll is driven here rather than by the browser's smooth scroll, which
   * covers any distance in ~150 ms and turns a seven-stop jump into a flicker of seven moments.
   */
  /**
   * Ride the train to stop `next` over `duration` ms. The scroll is driven here rather than by the
   * browser's smooth scroll, which covers any distance in ~150 ms, and it is eased on the train's
   * position rather than on the scroll: it moves from the first frame to the last, instead of idling
   * through the rest of the platform and then lurching.
   */
  const fly = useCallback(
    (next: number, duration?: number) => {
      const g = geo.current;
      const y = scrollTargetFor(next);
      if (!g || y == null) return;
      cancelFlight();
      const pFrom = trainPosition((window.scrollY + g.rideTop - g.railTop) / g.step, n);
      const travelled = next - pFrom;
      if (Math.abs(travelled) < 1e-3) {
        window.scrollTo({ top: y, behavior: 'instant' });
        return;
      }
      const ms = duration ?? rideDuration(travelled);
      const start = performance.now();
      if (Math.ceil(Math.max(pFrom, next)) - Math.floor(Math.min(pFrom, next)) > 1) {
        // Express: the stations between flash past on the line, not on the stage.
        const origin = Math.round(pFrom);
        express.current = { from: origin, to: next };
        const items = root.current?.querySelectorAll<HTMLElement>('.bd-ride__stop');
        items?.[origin]?.setAttribute('data-express-end', '');
        items?.[next]?.setAttribute('data-express-end', '');
        if (stage.current) stage.current.dataset.express = '';
      }
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        const top = t < 1 ? g.railTop - g.rideTop + rawScrollFor(pFrom + travelled * glide(t)) * g.step : y;
        window.scrollTo({ top, behavior: 'instant' });
        if (t < 1) flight.current = { raf: window.requestAnimationFrame(tick), to: next };
        else {
          flight.current = null;
          endExpress();
        }
        renderNow.current();
      };
      flight.current = { raf: window.requestAnimationFrame(tick), to: next };
    },
    [n, scrollTargetFor, cancelFlight, endExpress],
  );

  /** Ride to stop `i`, and put it in the address bar so it can be shared. */
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
      if (instant || window.matchMedia(REDUCE).matches) {
        cancelFlight();
        window.scrollTo({ top: y, behavior: 'instant' });
        return;
      }
      fly(next);
    },
    [n, ride, scrollTargetFor, stops, cancelFlight, fly],
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
    // The two layers of each moment that move: its words and its picture. --d is registered as not
    // inherited (ride.css), so writing it restyles these few elements, not every paragraph inside them.
    const layers = [...el.querySelectorAll<HTMLElement>('.bd-ride__stop')].map((li) => [...li.querySelectorAll<HTMLElement>('.bd-stopcard__text, .bd-stopcard__media, .bd-stopcard__numeral')]);
    const setD = (i: number, d: number) => layers[i]?.forEach((layer) => layer.style.setProperty('--d', d.toFixed(4)));
    const train = el.querySelector<HTMLElement>('.bd-ride-map__train');

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
        map = { gap: b.offsetLeft - a.offsetLeft, first: a.offsetLeft, size: vp.clientWidth, total: vp.scrollWidth };
        st.style.setProperty('--map-gap', `${map.gap}px`);
        st.style.setProperty('--map-first', `${a.offsetLeft + a.offsetWidth / 2}px`);
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
      const index = Math.round(p);
      const docked = Math.abs(p - index) < 0.002;
      // The car card keeps the train mid-strip and the line slides under it. It is a real scroller, so
      // a guest can swipe to a far station and focus scrolls to a tabbed one; while they do, it is theirs.
      // (Scroll is written before any style, so it never forces a restyle mid-frame.)
      const vp = mapViewport.current;
      if (g.map && vp && !mapHold.current) {
        const { gap, first, size, total } = g.map;
        const left = total <= size ? 0 : Math.max(0, Math.min(total - size, first + p * gap + gap / 2 - size / 2));
        if (Math.abs(vp.scrollLeft - left) > 0.5) vp.scrollLeft = left;
      }
      // Each moment near the train gets its own distance from it, --d; nothing else restyles per frame.
      train?.style.setProperty('--p', p.toFixed(4));
      const ex = express.current;
      if (ex) {
        const k = Math.min(1, Math.max(0, (p - ex.from) / (ex.to - ex.from)));
        const dir = Math.sign(ex.to - ex.from);
        setD(ex.from, -k * dir);
        setD(ex.to, (1 - k) * dir);
      } else {
        for (let i = Math.max(0, Math.floor(p) - 1); i <= Math.min(n - 1, Math.ceil(p) + 1); i++) setD(i, i - p);
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
        st.dataset.docked = docked ? 'true' : 'false';
        last = { index, docked, toward };
        setAt(last);
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(frameFn);
    };
    reframe.current = schedule;
    renderNow.current = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frameFn();
    };
    const remeasure = () => {
      // A train standing at a station stays there when the page reflows above or around it (a font or a
      // picture arriving late, a rotated phone): the scroll follows the platform, not the old pixels.
      const before = geo.current;
      let dockedAt: number | null = null;
      if (before && !flight.current) {
        const p = trainPosition((window.scrollY + before.rideTop - before.railTop) / before.step, n);
        const pinnedNow = window.scrollY + before.rideTop >= before.railTop - 1 && window.scrollY + before.rideTop + before.stageH <= before.railTop + before.railH + 1;
        if (pinnedNow && Math.abs(p - Math.round(p)) < 0.002) dockedAt = Math.round(p);
      }
      measure();
      const after = geo.current;
      if (dockedAt != null && after && before && (after.railTop !== before.railTop || after.step !== before.step || after.rideTop !== before.rideTop)) {
        window.scrollTo({ top: after.railTop - after.rideTop + (dockedAt + DWELL / 2) * after.step, behavior: 'instant' });
      }
      schedule();
    };
    /*
     * Settling. When a guest stops scrolling with the train between two stations, it rolls on to the
     * one it was heading for (or back to the one it barely left) — gently, and only once their hand is
     * off: never while a finger is on the glass or a button is held, never mid-fling. A train already
     * standing at a platform is left exactly where it is. This replaces CSS scroll snap, which on a
     * ride this long catches almost every position and pulls each notch of a mouse wheel back.
     */
    let settleTimer = 0;
    let held = false;
    let heading = 0;
    let lastY = window.scrollY;
    const settle = () => {
      window.clearTimeout(settleTimer);
      settleTimer = 0;
      const g = geo.current;
      if (!g || flight.current || held) return;
      const railStart = g.railTop - g.rideTop;
      const y = window.scrollY;
      if (y < railStart || y > railStart + g.railH - g.stageH) return;
      const p = trainPosition((y - railStart) / g.step, n);
      const i = Math.floor(p);
      const f = p - i;
      if (f < 0.002 || f > 0.998) return;
      const target = heading > 0 ? (f > 0.2 ? i + 1 : i) : heading < 0 ? (f < 0.8 ? i : i + 1) : Math.round(p);
      fly(target, 280 + 560 * Math.abs(target - p));
    };
    const settleSoon = (ms = 220) => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, ms);
    };
    const hasScrollEnd = 'onscrollend' in window;
    const onScroll = () => {
      schedule();
      const y = window.scrollY;
      if (!flight.current && y !== lastY) heading = Math.sign(y - lastY);
      lastY = y;
      // Without scrollend, every scroll restarts the wait; with it, a settle already waiting (a finger
      // just lifted, momentum still carrying the page) waits for the page to come to rest.
      if (!flight.current && (!hasScrollEnd || settleTimer)) settleSoon();
    };
    const onScrollEnd = () => settleSoon(140);
    const hold = () => {
      held = true;
      window.clearTimeout(settleTimer);
    };
    const release = () => {
      held = false;
      settleSoon();
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
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', onScrollEnd);
    window.addEventListener('touchstart', hold, { passive: true });
    window.addEventListener('touchend', release);
    window.addEventListener('touchcancel', release);
    window.addEventListener('pointerdown', hold);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('resize', remeasure);
    window.addEventListener('wheel', interrupt, { passive: true });
    window.addEventListener('touchstart', interruptPointer, { passive: true });
    window.addEventListener('keydown', interruptKey);
    window.addEventListener('pointerdown', interruptPointer);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('scrollend', onScrollEnd);
      window.removeEventListener('touchstart', hold);
      window.removeEventListener('touchend', release);
      window.removeEventListener('touchcancel', release);
      window.removeEventListener('pointerdown', hold);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('wheel', interrupt);
      window.removeEventListener('touchstart', interruptPointer);
      window.removeEventListener('keydown', interruptKey);
      window.removeEventListener('pointerdown', interruptPointer);
      if (frame) window.cancelAnimationFrame(frame);
      cancelFlight();
      delete document.documentElement.dataset.ridePinned;
      reframe.current = () => {};
      renderNow.current = () => {};
    };
  }, [ride, factor, n, stops, cancelFlight, fly]);

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

  // Only the station at the platform takes focus; links inside moments passing by are taken out of
  // the tab order (their words stay in the page for find-in-page).
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

  // Words before pictures, in the fit too: a moment too tall for its window lets its picture go before
  // any of its words have to scroll. Measured for every stop at once (they are all laid out, hidden or
  // not), on arrival and on every resize, so a picture never vanishes mid-transition.
  useEffect(() => {
    if (!ride) return;
    let raf = 0;
    const fitAll = () => {
      raf = 0;
      const items = root.current?.querySelectorAll<HTMLElement>('.bd-ride__stop') ?? [];
      items.forEach((li) => delete li.dataset.tight);
      items.forEach((li) => {
        const platform = li.querySelector<HTMLElement>('.bd-ride__platform');
        if (platform && li.querySelector('.bd-stopcard__media') && platform.scrollHeight > platform.clientHeight + 2) li.dataset.tight = '';
      });
    };
    const soon = () => {
      if (!raf) raf = window.requestAnimationFrame(fitAll);
    };
    fitAll();
    window.addEventListener('resize', soon);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', soon);
    };
  }, [ride]);

  // Does the moment at the platform fit its window? If not it scrolls on its own, says so, and takes focus.
  // Asked only once the train has stopped: measuring mid-run would force a layout inside a moving frame.
  useEffect(() => {
    if (!ride || !at.docked) return;
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
  }, [ride, at.index, at.docked]);

  const onMapClick = (e: MouseEvent<HTMLAnchorElement>, i: number) => {
    if (!ride) return;
    e.preventDefault();
    go(i);
  };

  /** Arrow keys walk the line (one tab stop, like any list of choices); Enter rides there. */
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
  const upcoming = at.docked ? stops[at.index + 1] : stops[at.toward];
  const tabbable = enhanced ? (focusIdx ?? (ride ? at.index : 0)) : null;
  const align = (i: number) => (i < 1 ? 'start' : i > n - 2 ? 'end' : undefined);

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
      <div ref={rail} className="bd-ride__rail">
        <div ref={stage} className="bd-ride__stage" data-docked="true">
          <header className="bd-ride__head">
            <h2 id="ride-title" className="bd-ride__title">
              {title}
            </h2>
            {ride ? (
              <p className="bd-ride__count" aria-hidden="true">
                Stop {at.index + 1} of {n}
              </p>
            ) : null}
            {enhanced && motionOk ? (
              <button type="button" className="bd-ride__mode-btn" aria-pressed={asList} onClick={() => chooseList(!asList)}>
                {asList ? 'Ride the line instead' : 'Read it as a list'}
              </button>
            ) : null}
          </header>

          <nav className="bd-ride-map" aria-label={`Stations on the ${lineName}`} onBlur={onMapBlur}>
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
                    data-next-line={stops[i + 1]?.line}
                    data-current={ride && i === at.index ? '' : undefined}
                    data-passed={ride && i < at.index ? '' : undefined}
                    data-align={align(i)}
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
            <ol className="bd-ride__track" aria-label={`${lineName}, in order`}>
              {cards.map((card, i) => {
                const s = stops[i];
                if (!s) return null;
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
                    data-near={ride && Math.abs(i - at.index) <= 1 ? '' : undefined}
                    data-overflow={over ? (overflow?.more ? 'more' : 'end') : undefined}
                    style={{ '--i': i } as CSSProperties}
                    // Riding, the station at the platform is the one exposed section; the moments on
                    // either side are hidden from assistive technology and out of the tab order.
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
          </div>

          {ride && current ? (
            <div className="bd-ride__bar">
              <p className="sr-only" aria-live="polite">
                {announced}
              </p>
              <div className="bd-ride__controls">
                <p className="bd-ride__next" aria-hidden="true">
                  {upcoming && (at.docked ? at.index < n - 1 : true) ? (
                    <>
                      <span className="bd-ride__next-kicker">{at.docked ? 'Next stop' : 'Arriving at'}</span>
                      <span className="bd-ride__next-name" data-line={upcoming.line}>
                        {upcoming.name}
                      </span>
                    </>
                  ) : (
                    <span className="bd-ride__next-kicker">End of the line</span>
                  )}
                </p>
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
    </section>
  );
}

/** What the car would say: "This is Starved Rock. Next stop, Greater together than alone." */
function announcement(stop: RideStop, next: RideStop | undefined): string {
  if (stop.kind === 'terminal') return `This is ${stop.name}, the end of the line.`;
  return next ? `This is ${stop.name}. Next stop, ${next.name}.` : `This is ${stop.name}.`;
}
