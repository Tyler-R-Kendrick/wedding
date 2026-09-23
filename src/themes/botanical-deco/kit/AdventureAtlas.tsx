'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type WheelEvent } from 'react';
import {
  ATLAS_H,
  ATLAS_W,
  MAX_ZOOM,
  MIN_ZOOM,
  clampView,
  clusterPoints,
  fitView,
  homeView,
  inseparable,
  lerpView,
  panBy,
  project,
  viewBox,
  zoomAt,
  type AtlasCluster,
  type AtlasView,
} from '@/themes/shared/atlas/projection';

/**
 * Our Adventures as an atlas: a stylized world with a numbered gold pin for every adventure that
 * has a place, and the wedding marked as the Deco diamond it all leads to. Guests zoom and drag
 * around it; choosing a pin opens that adventure's postcard beside the map.
 *
 * Like the Chicago guide on Explore, the list is the whole truth and the map only adds to it. The
 * ledger and the postcards are rendered on the server and handed in as `children` and `postcards`,
 * so nothing a guest reads depends on this bundle: without JavaScript the ledger still works, and a
 * screen reader or keyboard reaches every adventure from it. The map's pins are real buttons, the
 * zoom has buttons, and every gesture has a keyboard equivalent.
 *
 * The world is one cached file (public/assets/atlas/world.svg) drawn through <use>, so its ~160 KB
 * of coastline is fetched once and never rides in the HTML or the RSC payload.
 */

export interface AtlasPin {
  id: string;
  title: string;
  /** "01": the adventure's number in the ledger, printed in its pin. */
  number: string;
  lat: number;
  lng: number;
}

export interface AtlasVenue {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

const WORLD = '/assets/atlas/world.svg';
/** The frame before it is measured: the drawing's own shape, so the server render and the first paint agree. */
const DEFAULT_ASPECT = ATLAS_W / ATLAS_H;
const DEFAULT_WIDTH = 1000;
const STEP = 1.8;
const START: AtlasView = { cx: ATLAS_W / 2, cy: ATLAS_H / 2, k: 1 };
const LABEL_ZOOM = 3;

type Point = { id: string; x: number; y: number; kind: 'pin' | 'venue'; title: string; number?: string };

type Rect = { x0: number; x1: number; y0: number; y1: number };
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Which single markers get a name beside them, and on which side. The chosen one is placed first;
 * every other name goes right, else left, else nowhere — never across another marker or name, and
 * never off the frame. Widths are estimated from the text (17px italic Bodoni runs ~8px a letter).
 */
function placeLabels(clusters: AtlasCluster<Point>[], chosen: string | null, all: boolean, vb: { x: number; y: number; w: number; h: number }, width: number, aspect: number) {
  const height = width / aspect;
  const screen = (c: { x: number; y: number }) => ({ sx: ((c.x - vb.x) / vb.w) * width, sy: ((c.y - vb.y) / vb.h) * height });
  const taken: Rect[] = clusters.map((c) => {
    const { sx, sy } = screen(c);
    return { x0: sx - 16, x1: sx + 16, y0: sy - 32, y1: sy + 12 };
  });
  // The zoom buttons' corner (three 44px buttons, 8px in from the top right) and the compass's.
  taken.push({ x0: width - 60, x1: width, y0: 0, y1: 150 }, { x0: 0, x1: 52, y0: height - 60, y1: height });
  const sides = new Map<string, 'left' | 'right'>();
  const singles = clusters.filter((c) => c.members.length === 1).sort((a, b) => Number(b.members[0]?.id === chosen) - Number(a.members[0]?.id === chosen));
  for (const c of singles) {
    const m = c.members[0];
    if (!m || !(all || m.id === chosen)) continue;
    const { sx, sy } = screen(c);
    const text = m.kind === 'venue' ? 'Our wedding' : m.title;
    const w = text.length * 8 + 8;
    const cy = m.kind === 'venue' ? sy : sy - 14;
    const box = (side: 'left' | 'right'): Rect => (side === 'right' ? { x0: sx + 20, x1: sx + 22 + w, y0: cy - 11, y1: cy + 11 } : { x0: sx - 22 - w, x1: sx - 20, y0: cy - 11, y1: cy + 11 });
    for (const side of ['right', 'left'] as const) {
      const r = box(side);
      if (r.x0 < 0 || r.x1 > width || taken.some((t) => overlaps(t, r))) continue;
      taken.push(r);
      sides.set(c.id, side);
      break;
    }
  }
  return sides;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function AdventureAtlas({ pins, venue, overview, postcards, children }: { pins: AtlasPin[]; venue: AtlasVenue; overview: ReactNode; postcards: ReactNode; children: ReactNode }) {
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ width: DEFAULT_WIDTH, aspect: DEFAULT_ASPECT });
  const [view, setViewState] = useState<AtlasView>(START);
  const [chosen, setChosen] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Gestures read the current view between renders, so the ref is written wherever the view is.
  const viewRef = useRef<AtlasView>(START);
  const setView = useCallback((next: AtlasView) => {
    viewRef.current = next;
    setViewState(next);
  }, []);
  const moved = useRef(false);
  const anim = useRef<number | null>(null);

  const points = useMemo<Point[]>(
    () => [
      ...pins.map((p) => ({ id: p.id, kind: 'pin' as const, title: p.title, number: p.number, ...project(p.lat, p.lng) })),
      { id: venue.id, kind: 'venue' as const, title: venue.name, ...project(venue.lat, venue.lng) },
    ],
    [pins, venue],
  );

  // ---------------------------------------------------------------------------------- moving
  const stop = () => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
  };
  const jump = useCallback(
    (next: AtlasView) => {
      stop();
      setView(next);
    },
    [setView],
  );
  const fly = useCallback(
    (next: AtlasView) => {
      stop();
      if (reducedMotion()) return setView(next);
      const from = viewRef.current;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 520);
        setView(lerpView(from, next, t));
        anim.current = t < 1 ? requestAnimationFrame(tick) : null;
      };
      anim.current = requestAnimationFrame(tick);
    },
    [setView],
  );
  useEffect(() => stop, []);

  // Measure the frame; open on the home view once, then only keep the view valid as it resizes.
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const aspect = width / height;
      setFrame({ width, aspect });
      setView(moved.current ? clampView(viewRef.current, aspect) : homeView(aspect, points));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    setReady(true);
    return () => ro.disconnect();
  }, [points, setView]);

  const { aspect, width } = frame;
  const vb = viewBox(view, aspect);
  const upp = ATLAS_W / view.k / width; // drawing units per screen pixel
  const clusters = useMemo(() => clusterPoints(points, view.k, width), [points, view.k, width]);

  const zoomBy = (factor: number) => {
    moved.current = true;
    fly(zoomAt(viewRef.current, factor, aspect));
  };
  const goHome = () => {
    moved.current = false;
    fly(homeView(aspect, points));
  };

  // ---------------------------------------------------------------------------------- choosing
  /**
   * Open a postcard and hand it focus, so a screen reader reads what was opened. `scroll` is false
   * when the caller has already scrolled the map into view and the postcard should not pull it away.
   */
  const reveal = useCallback((id: string, scroll = true) => {
    setChosen(id);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-atlas-entry="${CSS.escape(id)}"] [data-atlas-focus]`)?.focus({ preventScroll: !scroll }));
  }, []);

  const choosePoint = (p: Point) => reveal(p.id);

  const chooseCluster = (c: AtlasCluster<Point>) => {
    const [first] = c.members;
    if (!first) return;
    if (c.members.length === 1) return choosePoint(first);
    moved.current = true;
    // One place, several memories: zooming cannot separate them, so open the first of them.
    if (inseparable(c.members, width)) return reveal(c.members.find((m) => m.kind === 'pin')?.id ?? first.id);
    fly(fitView(c.members, aspect, { pad: 0.3 }));
  };

  /** "Show on the map" from the ledger: fly to the pin, bring the map into view, open its postcard. */
  const showOnMap = useCallback(
    (id: string) => {
      const p = points.find((q) => q.id === id);
      if (!p) return;
      moved.current = true;
      fly(clampView({ cx: p.x, cy: p.y, k: Math.max(viewRef.current.k, 6) }, aspect));
      canvas.current?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      reveal(id, false);
    },
    [points, aspect, fly, reveal],
  );

  // A filter can take away the chosen adventure; fall back to the key rather than an empty panel.
  if (chosen !== null && !points.some((p) => p.id === chosen)) setChosen(null);

  // The postcards and the ledger are server-rendered; the chosen one is marked with an attribute.
  // A layout effect, so the postcard is displayed before `reveal` tries to focus it.
  useLayoutEffect(() => {
    for (const el of root.current?.querySelectorAll<HTMLElement>('[data-atlas-entry]') ?? []) {
      if (el.dataset.atlasEntry === chosen) el.setAttribute('data-open', 'true');
      else el.removeAttribute('data-open');
    }
    for (const el of root.current?.querySelectorAll<HTMLElement>('[data-atlas-row]') ?? []) {
      if (el.dataset.atlasRow === chosen) el.setAttribute('data-active', 'true');
      else el.removeAttribute('data-active');
    }
  }, [chosen]);

  // Ledger buttons and the postcards' close buttons, by delegation (they are server markup).
  const onRootClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const show = target.closest<HTMLElement>('[data-atlas-show]');
    if (show?.dataset.atlasShow) return showOnMap(show.dataset.atlasShow);
    if (target.closest('[data-atlas-close]')) {
      const was = chosen;
      setChosen(null);
      requestAnimationFrame(() => {
        const pin = root.current?.querySelector<HTMLElement>(`[data-pin="${CSS.escape(was ?? '')}"]`);
        (pin ?? canvas.current)?.focus();
      });
    }
  };

  // ---------------------------------------------------------------------------------- gestures
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; view: AtlasView; mid: { x: number; y: number } } | null>(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // One finger on a phone scrolls the page until the map is zoomed in; two always pinch.
    if (e.pointerType === 'touch' && pointers.current.size === 0 && viewRef.current.k <= homeView(aspect, points).k + 0.01) {
      pointers.current.set(e.pointerId, local(e));
      return;
    }
    stop();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const [a, b] = [...pointers.current.values()];
    if (a && b) {
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), view: viewRef.current, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = local(e);
    pointers.current.set(e.pointerId, now);
    const [a, b] = [...pointers.current.values()];
    if (a && b && pinch.current) {
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      moved.current = true;
      jump(zoomAt(pinch.current.view, dist / pinch.current.dist, aspect, pinch.current.mid.x / now.w, pinch.current.mid.y / now.h));
      return;
    }
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = now.x - prev.x, dy = now.y - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 0) {
      moved.current = true;
      jump(panBy(viewRef.current, dx, dy, now.w, aspect));
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const p = local(e);
    moved.current = true;
    fly(zoomAt(viewRef.current, e.shiftKey ? 1 / STEP : STEP, aspect, p.x / p.w, p.y / p.h));
  };

  // A plain wheel scrolls the page past the map; Ctrl/⌘ + wheel (and a trackpad pinch) zooms it.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const p = local(e);
    moved.current = true;
    jump(zoomAt(viewRef.current, Math.exp(-e.deltaY * 0.01), aspect, p.x / p.w, p.y / p.h));
  };
  // React's onWheel is passive, so stopping the browser's own page zoom needs a native listener.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const block = (e: globalThis.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = 80;
    const pan = (dx: number, dy: number) => {
      e.preventDefault();
      moved.current = true;
      jump(panBy(viewRef.current, dx, dy, width, aspect));
    };
    switch (e.key) {
      case 'ArrowLeft': return pan(step, 0);
      case 'ArrowRight': return pan(-step, 0);
      case 'ArrowUp': return pan(0, step);
      case 'ArrowDown': return pan(0, -step);
      case '+':
      case '=': e.preventDefault(); return zoomBy(STEP);
      case '-':
      case '_': e.preventDefault(); return zoomBy(1 / STEP);
      case '0':
      case 'Home': e.preventDefault(); return goHome();
    }
  };

  // ---------------------------------------------------------------------------------- drawing
  const home = homeView(aspect, points);
  const atHome = Math.abs(view.k - home.k) < 0.01 && Math.abs(view.cx - home.cx) < 0.5 && Math.abs(view.cy - home.cy) < 0.5;
  const inView = (x: number, y: number) => x >= vb.x - 20 * upp && x <= vb.x + vb.w + 20 * upp && y >= vb.y - 20 * upp && y <= vb.y + vb.h + 20 * upp;
  const pct = (x: number, y: number) => ({ left: `${((x - vb.x) / vb.w) * 100}%`, top: `${((y - vb.y) / vb.h) * 100}%` });
  const showLabels = view.k >= LABEL_ZOOM;
  const labelSides = placeLabels(clusters, chosen, showLabels, vb, width, aspect);
  const chosenCluster = clusters.find((c) => c.members.some((m) => m.id === chosen));

  const labelFor = (c: AtlasCluster<Point>) => {
    const m = c.members.length === 1 ? c.members[0] : undefined;
    if (m) {
      return m.kind === 'venue' ? `${m.title}, where we are getting married` : `${m.number}. ${m.title}`;
    }
    const names = c.members.map((m) => (m.kind === 'venue' ? 'our wedding' : m.title));
    return `${c.members.length} places close together: ${names.join(', ')}. Zoom in to see them.`;
  };

  return (
    <div className="bd-atlas" ref={root} data-ready={ready ? 'true' : undefined} data-chosen={chosen ?? undefined} onClick={onRootClick}>
      <div className="bd-atlas__stage">
        <figure className="bd-atlas__map" aria-labelledby={`${uid}-caption`}>
          <div
            ref={canvas}
            className="bd-atlas__canvas"
            tabIndex={0}
            role="region"
            aria-roledescription="map"
            aria-label="Map of our adventures. Arrow keys move the map; plus and minus zoom; 0 shows the whole map. The same adventures are listed below it."
            data-zoomed={view.k > home.k + 0.01 ? 'true' : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
            onKeyDown={onKeyDown}
          >
            <svg className="bd-atlas__svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
              <use href={`${WORLD}#outline`} className="bd-atlas__sea" />
              <use href={`${WORLD}#graticule`} className="bd-atlas__grid" />
              <use href={`${WORLD}#tropics`} className="bd-atlas__tropics" />
              <use href={`${WORLD}#equator`} className="bd-atlas__equator" />
              <use href={`${WORLD}#land`} className="bd-atlas__land" />
              <use href={`${WORLD}#lakes`} className="bd-atlas__lakes" />
              <use href={`${WORLD}#borders`} className="bd-atlas__borders" />
              {view.k >= 2.5 ? <use href={`${WORLD}#states`} className="bd-atlas__states" /> : null}
              {clusters.map((c) => {
                if (!inView(c.x, c.y)) return null;
                const single = c.members.length === 1 ? c.members[0] : null;
                const hasVenue = c.members.some((m) => m.kind === 'venue');
                const active = c === chosenCluster;
                const side = labelSides.get(c.id);
                return (
                  <g key={c.id} className="bd-atlas__marker" data-kind={single ? single.kind : 'cluster'} data-active={active ? 'true' : undefined} transform={`translate(${c.x} ${c.y}) scale(${upp})`}>
                    {single?.kind === 'venue' ? (
                      <>
                        <rect className="bd-atlas__diamond" x="-9" y="-9" width="18" height="18" transform="rotate(45)" />
                        <rect className="bd-atlas__diamond-inner" x="-4" y="-4" width="8" height="8" transform="rotate(45)" />
                      </>
                    ) : single ? (
                      <>
                        <circle className="bd-atlas__halo" cy="-14" r="22" />
                        <path className="bd-atlas__drop" d="M0 18C-3 11-14 5-14-5a14 14 0 0 1 28 0c0 10-11 16-14 23Z" transform="translate(0 -14)" />
                        <text className="bd-atlas__num" y="-14" dy="0.36em" textAnchor="middle">
                          {single.number}
                        </text>
                      </>
                    ) : (
                      <>
                        <circle className="bd-atlas__halo" r="26" />
                        <circle className="bd-atlas__cluster" r="17" />
                        <circle className="bd-atlas__cluster-ring" r="21" />
                        {hasVenue ? <rect className="bd-atlas__cluster-venue" x="-4" y="-4" width="8" height="8" transform="translate(15 -15) rotate(45)" /> : null}
                        <text className="bd-atlas__num" dy="0.36em" textAnchor="middle">
                          {c.members.filter((m) => m.kind === 'pin').length || c.members.length}
                        </text>
                      </>
                    )}
                    {single && side ? (
                      <text className="bd-atlas__label" x={side === 'left' ? -22 : 22} y={single.kind === 'venue' ? 0 : -14} dy="0.36em" textAnchor={side === 'left' ? 'end' : 'start'}>
                        {single.kind === 'venue' ? 'Our wedding' : single.title}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
            {/* The drawn markers are pictures; these 44px buttons sit on them and are what a guest presses. */}
            <div className="bd-atlas__targets">
              {clusters.map((c) => {
                if (!inView(c.x, c.y)) return null;
                const single = c.members.length === 1 ? c.members[0] : null;
                const at = pct(c.x, single?.kind === 'pin' ? c.y - 14 * upp : c.y);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="bd-atlas__target"
                    data-pin={single?.id}
                    style={at}
                    aria-label={labelFor(c)}
                    aria-pressed={single ? chosen === single.id : undefined}
                    onClick={() => chooseCluster(c)}
                  />
                );
              })}
            </div>
            <div className="bd-atlas__zoom" role="group" aria-label="Zoom">
              <button type="button" className="bd-atlas__zoombtn" onClick={() => zoomBy(STEP)} disabled={view.k >= MAX_ZOOM - 0.01} aria-label="Zoom in">
                <svg className="bd-atlas__icon" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 4v12M4 10h12" />
                </svg>
              </button>
              <button type="button" className="bd-atlas__zoombtn" onClick={() => zoomBy(1 / STEP)} disabled={view.k <= MIN_ZOOM + 0.01} aria-label="Zoom out">
                <svg className="bd-atlas__icon" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M4 10h12" />
                </svg>
              </button>
              <button type="button" className="bd-atlas__zoombtn" onClick={goHome} disabled={atHome} aria-label="Show the whole map">
                <svg className="bd-atlas__icon" viewBox="0 0 20 20" aria-hidden="true">
                  <ellipse cx="10" cy="10" rx="8" ry="5.5" />
                  <path d="M2 10h16M10 4.5v11" />
                </svg>
              </button>
            </div>
            <span className="bd-atlas__compass" aria-hidden="true">
              <svg className="bd-atlas__compass-rose" viewBox="0 0 40 40">
                <path d="M20 3l4 17-4 17-4-17Z" className="bd-atlas__compass-needle" />
                <path d="M3 20l17-4 17 4-17 4Z" className="bd-atlas__compass-cross" />
              </svg>
              <span className="bd-atlas__compass-n">N</span>
            </span>
          </div>
          <figcaption id={`${uid}-caption`} className="bd-atlas__note">
            Drag to move. Zoom with + and −, a pinch, a double-click, or Ctrl (⌘ on a Mac) and scroll. Coastlines from Natural Earth.
          </figcaption>
        </figure>
        <aside className="bd-atlas__panel" aria-label="The chosen adventure">
          <div className="bd-atlas__overview" hidden={chosen !== null}>
            {overview}
          </div>
          {postcards}
        </aside>
      </div>
      {children}
    </div>
  );
}
