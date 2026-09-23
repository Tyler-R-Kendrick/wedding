'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from 'react';

/**
 * Our Story as a ride on the 'L' (docs/design/inspo/our-story-timeline.md).
 *
 * The page is as tall as the ride; a sticky stage holds every stop at its own depth down a track, and
 * native scroll moves the camera forward through them. One rAF-throttled listener writes one custom
 * property, `--p` (the train's position in stops); CSS turns it into every card's depth, drift and
 * haze, the sleepers running under the floor, and the train on the car-card map. Scroll maps to `--p`
 * with plateaus — a short run of travel, then a longer stretch stopped at the station — so nobody has
 * to read a memory while it is moving.
 *
 * It works without script and without motion. The server renders the same ordered list flat: a
 * vertical strip map with each stop a readable section beside its line, every stop a `#slug` anchor
 * (an assistant's citation `/our-story#love` lands on it). Script upgrades that to the ride only when
 * the guest has not asked for reduced motion, and the page prints flat.
 *
 * Riding, it behaves like a carousel for assistive technology: the car-card map is the list of every
 * station (a link each, the current one `aria-current="location"`), the station at the platform is the
 * one readable section, and a polite live region says where the train has stopped.
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
const DWELL = 0.5;

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

const noop = () => () => {};
const REDUCE = '(prefers-reduced-motion: reduce)';
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

export function StoryRide({ stops, cards, lineName, intro }: { stops: RideStop[]; cards: ReactNode[]; lineName: string; intro: ReactNode }) {
  // Flat on the server, without script, with reduced motion, and while printing.
  const ride = useSyncExternalStore(
    onMotionChange,
    () => !window.matchMedia(REDUCE).matches && !window.matchMedia('print').matches,
    () => false,
  );
  const enhanced = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const root = useRef<HTMLElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const mapList = useRef<HTMLOListElement>(null);
  const mapViewport = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ index: 0, docked: true, toward: 0 });
  const [announced, setAnnounced] = useState('');
  const n = stops.length;
  const factor = stepFactor(n);

  /** Scroll offset (document px) where stop `i` is docked, mid-plateau. */
  const scrollTargetFor = useCallback(
    (i: number) => {
      const el = rail.current;
      const st = stage.current;
      if (!el || !st) return null;
      const top = el.getBoundingClientRect().top + window.scrollY - rideTop(root.current);
      return top + (i + DWELL * 0.4) * st.clientHeight * factor;
    },
    [factor],
  );

  const go = useCallback(
    (i: number, behavior: ScrollBehavior = 'smooth') => {
      const next = Math.min(Math.max(i, 0), n - 1);
      const stop = stops[next];
      if (!stop) return;
      window.history.replaceState(window.history.state, '', `#${stop.slug}`);
      if (!ride) {
        document.getElementById(stop.slug)?.scrollIntoView({ block: 'start' });
        return;
      }
      const y = scrollTargetFor(next);
      if (y != null) window.scrollTo({ top: y, behavior: window.matchMedia(REDUCE).matches ? 'auto' : behavior });
    },
    [n, ride, scrollTargetFor, stops],
  );

  // The engine: one listener, one custom property, React state only when the station changes.
  useEffect(() => {
    const el = root.current;
    const track = rail.current;
    const st = stage.current;
    if (!ride || !el || !track || !st) return;
    let frame = 0;
    let last = { index: -1, docked: false, toward: 0 };
    let lastP = 0;
    // The stage sits between the sticky masthead (desktop) and the fixed action bar (phone).
    const measureChrome = () => {
      const bar = [...document.querySelectorAll<HTMLElement>('.bd-masthead, .bd-bar')];
      const top = bar.find((b) => b.classList.contains('bd-masthead') && getComputedStyle(b).position === 'sticky');
      const bottom = bar.find((b) => b.classList.contains('bd-bar') && getComputedStyle(b).position === 'fixed' && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().height > 0);
      el.style.setProperty('--ride-top', `${top?.offsetHeight ?? 0}px`);
      el.style.setProperty('--ride-bottom', `${bottom?.offsetHeight ?? 0}px`);
    };
    measureChrome();
    const frameFn = () => {
      frame = 0;
      const step = st.clientHeight * factor;
      const raw = (rideTop(el) - track.getBoundingClientRect().top) / step;
      const p = trainPosition(raw, n);
      el.style.setProperty('--p', p.toFixed(4));
      const index = Math.round(p);
      const docked = Math.abs(p - index) < 0.002;
      // Between stations the train runs on the track of the stop it left; stopped, on the stop's own.
      const segment = Math.min(Math.floor(p + 0.0001), n - 1);
      el.style.setProperty('--train-track', String(stops[docked ? index : segment]?.track ?? 0));
      el.dataset.line = stops[index]?.line ?? stops[0]?.line ?? 'red';
      // Keep the train in the middle of the car card; the line slides under it.
      const list = mapList.current;
      const vp = mapViewport.current;
      if (list && vp && list.children.length > 1) {
        const a = list.children[0] as HTMLElement;
        const b = list.children[1] as HTMLElement;
        const vertical = b.offsetTop !== a.offsetTop;
        const gap = vertical ? b.offsetTop - a.offsetTop : b.offsetLeft - a.offsetLeft;
        const size = vertical ? vp.clientHeight : vp.clientWidth;
        const total = vertical ? list.scrollHeight : list.scrollWidth;
        const first = vertical ? a.offsetTop : a.offsetLeft;
        const shift = total <= size ? 0 : Math.min(0, Math.max(size - total, size / 2 - (first + p * gap + gap / 2)));
        el.style.setProperty('--map-gap', `${gap}px`);
        el.style.setProperty('--map-shift', `${shift.toFixed(1)}px`);
      }
      // Where the train is heading: forward when scrolling down, back when scrolling up.
      const toward = docked ? index : p >= lastP ? Math.ceil(p) : Math.floor(p);
      lastP = p;
      if (index !== last.index || docked !== last.docked || toward !== last.toward) {
        last = { index, docked, toward };
        setAt(last);
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(frameFn);
    };
    const onResize = () => {
      measureChrome();
      schedule();
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', onResize);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ride, factor, n, stops]);

  // A deep link (`/our-story#starved-rock`) lands on its station once the ride has its height.
  useEffect(() => {
    if (!ride) return;
    const jumpToHash = () => {
      const i = stops.findIndex((s) => `#${s.slug}` === window.location.hash);
      if (i >= 0) go(i, 'auto');
    };
    jumpToHash();
    window.addEventListener('hashchange', jumpToHash);
    return () => window.removeEventListener('hashchange', jumpToHash);
  }, [ride, go, stops]);

  // Announce arrivals only, and only once the train has settled: scrolling past five stations is not
  // five interruptions.
  useEffect(() => {
    if (!ride || !at.docked) return;
    const stop = stops[at.index];
    if (!stop) return;
    const t = window.setTimeout(() => setAnnounced(announcement(stop, stops[at.index + 1])), 600);
    return () => window.clearTimeout(t);
  }, [ride, at, stops]);

  const onMapClick = (e: MouseEvent<HTMLAnchorElement>, i: number) => {
    if (!ride) return;
    e.preventDefault();
    go(i);
  };

  const current = stops[at.index];
  const heading = stops[at.toward] ?? current;

  return (
    <section
      ref={root}
      className="bd-ride"
      data-mode={ride ? 'ride' : 'flat'}
      data-enhanced={enhanced ? '' : undefined}
      data-line={stops[0]?.line}
      aria-labelledby="ride-title"
      style={{ '--stops': n, '--step-factor': factor } as CSSProperties}
    >
      {intro}
      <div ref={rail} className="bd-ride__rail">
      <div ref={stage} className="bd-ride__stage">
        <nav className="bd-ride-map" aria-label={`Stations on the ${lineName}`}>
          <p className="bd-ride-map__title" aria-hidden="true">
            {lineName}
          </p>
          <div ref={mapViewport} className="bd-ride-map__viewport">
            <ol ref={mapList} className="bd-ride-map__list">
              {stops.map((s, i) => (
                <li
                  key={s.slug}
                  className="bd-ride-map__stop"
                  data-kind={s.kind}
                  data-line={s.line}
                  data-from={s.from?.line}
                  data-current={ride && i === at.index ? '' : undefined}
                  style={{ '--t': s.track, '--ft': s.from?.track ?? s.track } as CSSProperties}
                >
                  <a className="bd-ride-map__link" href={`#${s.slug}`} aria-current={ride && i === at.index ? 'location' : undefined} onClick={(e) => onMapClick(e, i)}>
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
              return (
                <li
                  key={s.slug}
                  id={s.slug}
                  className="bd-ride__stop"
                  data-kind={s.kind}
                  data-line={s.line}
                  data-state={!ride ? undefined : i === at.index ? 'here' : i < at.index ? 'passed' : 'ahead'}
                  style={{ '--i': i, '--side': side } as CSSProperties}
                  // Riding, only the station the train is at can be read or tabbed into — the others
                  // are scenery sliding past. The map, the two buttons and the arrival announcement
                  // reach every one of them; flat, all of them are ordinary sections.
                  inert={ride && i !== at.index ? true : undefined}
                >
                  {/* The card at the platform may be taller than a short phone's window and scrolls on
                      its own; it takes focus so a keyboard can scroll it too. */}
                  <div className="bd-ride__platform" {...(ride && i === at.index ? { tabIndex: 0, role: 'group', 'aria-labelledby': `${s.slug}-title` } : {})}>
                    {card}
                  </div>
                </li>
              );
            })}
          </ol>

          {ride && current ? (
            <div className="bd-ride__sign" data-line={current.line}>
              <p className="bd-ride__sign-text" aria-hidden="true">
                {at.docked ? (
                  <>
                    <span className="bd-ride__sign-kicker">{current.kind === 'terminal' ? 'End of the line' : 'This is'}</span>
                    <span className="bd-ride__sign-name">{current.name}</span>
                  </>
                ) : (
                  <>
                    <span className="bd-ride__sign-kicker">Next stop</span>
                    <span className="bd-ride__sign-name">{heading?.name}</span>
                  </>
                )}
              </p>
              <p className="sr-only" aria-live="polite">
                {announced}
              </p>
              <div className="bd-ride__controls">
                <button type="button" className="bd-ride__btn" onClick={() => go(at.index - 1)} disabled={at.index === 0}>
                  <span aria-hidden="true">←</span> Back a stop
                </button>
                <button type="button" className="bd-ride__btn bd-ride__btn--next" onClick={() => go(at.index + 1)} disabled={at.index >= n - 1}>
                  Next stop <span aria-hidden="true">→</span>
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

/** The sticky offset the stage rides at, as the CSS resolved it. */
function rideTop(el: HTMLElement | null): number {
  return el ? parseFloat(el.style.getPropertyValue('--ride-top')) || 0 : 0;
}

/** What the car would say: "This is Starved Rock. Transfer to the Green Line." */
function announcement(stop: RideStop, next: RideStop | undefined): string {
  if (stop.kind === 'terminal') return `This is ${stop.name}, the end of the line.`;
  const here = stop.kind === 'transfer' || stop.kind === 'origin' ? `This is the ${stop.lineName}: ${stop.name}.` : `This is ${stop.name}.`;
  return next && next.line !== stop.line && next.kind !== 'terminal' ? `${here} Next, transfer to the ${next.lineName}.` : here;
}
