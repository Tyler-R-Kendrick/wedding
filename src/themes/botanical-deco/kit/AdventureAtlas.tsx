'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { ATLAS_FILES } from '@/themes/shared/atlas/files';
import { MIDWEST, SKY, WORLD, layerOn, regionInView, type Layer } from '@/themes/shared/atlas/layers';
import {
  ATLAS_H,
  ATLAS_W,
  MAX_ZOOM,
  MIN_ZOOM,
  REGION,
  WORLD_MAX_ZOOM,
  clampView,
  clusterPoints,
  fitView,
  homeView,
  inRegion,
  inseparable,
  lerpView,
  panBy,
  project,
  unitsPerKm,
  viewBox,
  worldView,
  zoomAt,
  type AtlasCluster,
  type AtlasFocus,
  type AtlasView,
  type TargetRule,
  type ViewBox,
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
 * The world is one cached file (world.svg) drawn through <use>, so its ~160 KB of coastline is
 * fetched once and never rides in the HTML or the RSC payload. Around Lake Michigan a second file
 * (midwest.svg: 1:10m lakes, rivers and interstates, and the City of Chicago's own lakefront) is
 * drawn instead, which is what lets the map open on the neighbourhoods around the venue and zoom to
 * street scale there. Each file is clipped to its side of REGION.
 *
 * SPEED. Moving the map never goes through React. A drag, a pinch, a wheel or a flight writes the
 * live view to a ref and repaints imperatively (the base map's viewBox, each marker's translate, and
 * which layers are drawn at this depth); React renders only when the map comes to rest, and only then
 * are the pins re-clustered and their names placed. Layers are drawn only at depths where they are
 * visible and cheap (src/themes/shared/atlas/layers.ts has the measurements).
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

/** Home frames the venue and every pin within REACH_KM of it, never tighter than MIN_SPAN_KM across. */
const REACH_KM = 16;
const MIN_SPAN_KM = 9;
/** The frame before it is measured: the drawing's own shape, so the server render and the first paint agree. */
const DEFAULT_ASPECT = ATLAS_W / ATLAS_H;
const DEFAULT_WIDTH = 1000;
const STEP = 1.8;
const LABEL_ZOOM = 3;
const FLY_MS = 420;
/** A wheel or key move counts as finished this long after its last event; then the pins re-cluster. */
const SETTLE_MS = 140;
/** A press that travels less than this is a tap (it opens a pin), not the start of a drag. */
const SLOP_PX = 6;
/** Every marker's button is 44px square; a lone pin's sits 14px up, on the pin's head. */
const TARGET: TargetRule<Point> = { sizePx: 44, lift: (m) => (m.length === 1 && m[0]?.kind === 'pin' ? 14 : 0) };
const liftOf = (members: Point[]) => TARGET.lift?.(members) ?? 0;
/** Postcard photos warmed while the map is idle: the few nearest the middle of the frame. */
const IDLE_WARM = 6;

type Point = { id: string; x: number; y: number; kind: 'pin' | 'venue'; title: string; number?: string };

type Rect = { x0: number; x1: number; y0: number; y1: number };
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Which single markers get a name beside them, and on which side. The chosen one is placed first;
 * every other name goes right, else left, else nowhere — never across another marker or name, and
 * never off the frame. Widths are estimated from the text (17px italic Bodoni runs ~8px a letter).
 */
function placeLabels(clusters: AtlasCluster<Point>[], chosen: string | null, all: boolean, vb: ViewBox, width: number, aspect: number) {
  const height = width / aspect;
  const screen = (c: { x: number; y: number }) => ({ sx: ((c.x - vb.x) / vb.w) * width, sy: ((c.y - vb.y) / vb.h) * height });
  const taken: Rect[] = clusters.map((c) => {
    const { sx, sy } = screen(c);
    return { x0: sx - 16, x1: sx + 16, y0: sy - 32, y1: sy + 12 };
  });
  // The zoom buttons' corner (four 44px buttons, 8px in from the top right) and the compass's.
  taken.push({ x0: width - 60, x1: width, y0: 0, y1: 200 }, { x0: 0, x1: 52, y0: height - 60, y1: height });
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
/** Data saver on, or a 2G/3G connection: photos load only when asked for, never ahead. */
const constrained = () => {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(c?.saveData) || /(^|-)(2g|3g)$/.test(c?.effectiveType ?? '');
};
const sameView = (a: AtlasView, b: AtlasView) => a.k === b.k && a.cx === b.cx && a.cy === b.cy;
/** Screen position of a drawing point in a frame `width` pixels wide showing `vb`. */
const toScreen = (x: number, y: number, vb: ViewBox, width: number) => ({ sx: ((x - vb.x) / vb.w) * width, sy: ((y - vb.y) / vb.w) * width });
/** A screen point within `margin` pixels of a `width` × `height` frame. */
const within = (sx: number, sy: number, width: number, height: number, margin: number) => sx > -margin && sx < width + margin && sy > -margin && sy < height + margin;
/** A marker's drawing this far outside the frame is still drawn: its pin or name can reach in. */
const MARGIN_PX = 80;
/**
 * A marker's button, only this far: the canvas clips anything outside it, and a button no one can
 * see must not be a tab stop.
 */
const TARGET_MARGIN_PX = 20;

/**
 * A marker's drawing-unit position as written into `data-at`. Rounded: the projection's trig ran on
 * the server's V8 and again in the browser's, and they disagreed in the fourteenth digit
 * (90.393878269333 against 90.39387826933302), which React reports as a hydration mismatch it will
 * not patch. A thousandth of a drawing unit is far below a pixel at any zoom.
 */
const drawn = (n: number): number => Math.round(n * 1000) / 1000;

export function AdventureAtlas({ pins, venue, overview, postcards, children }: { pins: AtlasPin[]; venue: AtlasVenue; overview: ReactNode; postcards: ReactNode; children: ReactNode }) {
  const uid = useId();
  const clipId = `atlas-clip-${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const baseSvg = useRef<SVGSVGElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const points = useMemo<Point[]>(
    () => [
      ...pins.map((p) => ({ id: p.id, kind: 'pin' as const, title: p.title, number: p.number, ...project(p.lat, p.lng) })),
      { id: venue.id, kind: 'venue' as const, title: venue.name, ...project(venue.lat, venue.lng) },
    ],
    [pins, venue],
  );
  const focus = useMemo<AtlasFocus>(() => {
    const u = unitsPerKm(venue.lat);
    return { ...project(venue.lat, venue.lng), reach: REACH_KM * u, minSpan: MIN_SPAN_KM * u };
  }, [venue]);

  // The frame, the view the page last rendered (`view`: at rest), and the live one gestures move.
  // The server renders the home view in the drawing's own shape, so the first paint is already Chicago.
  const [frame, setFrame] = useState({ width: DEFAULT_WIDTH, aspect: DEFAULT_ASPECT });
  const frameRef = useRef(frame);
  const [view, setView] = useState<AtlasView>(() => homeView(DEFAULT_ASPECT, points, focus));
  const live = useRef<AtlasView>(view);
  const moved = useRef(false);

  // ---------------------------------------------------------------------------------- painting
  const paintQueued = useRef<number | null>(null);
  const anim = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Draw the live view: the base map's viewBox, every marker and its button, and the layers this depth shows. */
  const paint = useCallback(() => {
    const svg = baseSvg.current;
    const el = root.current;
    if (!svg || !el) return;
    const { width, aspect } = frameRef.current;
    const height = width / aspect;
    const v = live.current;
    const vb = viewBox(v, aspect);
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const inRegionView = regionInView(vb);
    const region = svg.querySelector<SVGGElement>('[data-region]');
    if (region) region.toggleAttribute('data-off', !inRegionView);
    for (const u of svg.querySelectorAll<SVGUseElement>('use[data-layer]')) {
      const on = layerOn({ kMin: Number(u.dataset.kMin ?? 0), kMax: Number(u.dataset.kMax ?? Infinity), detail: u.dataset.detail === 'true' }, v.k, vb);
      if (u.hasAttribute('data-off') === on) u.toggleAttribute('data-off', !on);
    }
    for (const m of el.querySelectorAll<HTMLElement | SVGGElement>('[data-at]')) {
      const [x, y, lift] = (m.dataset.at ?? '0 0 0').split(' ').map(Number) as [number, number, number];
      const { sx, sy } = toScreen(x, y, vb, width);
      const on = within(sx, sy, width, height, m instanceof SVGGElement ? MARGIN_PX : TARGET_MARGIN_PX);
      if (m.hasAttribute('data-off') === on) m.toggleAttribute('data-off', !on);
      if (!on) continue;
      if (m instanceof SVGGElement) m.setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
      else m.style.transform = `translate(${sx.toFixed(1)}px, ${(sy - lift).toFixed(1)}px)`;
    }
  }, []);

  /** React renders the view at rest; the pins re-cluster and the controls update. */
  const settle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    setView((was) => (sameView(was, live.current) ? was : live.current));
  }, []);

  /** Move the live view; paint on the next frame; settle now, after a pause, or when the gesture ends. */
  const moveTo = useCallback(
    (next: AtlasView, when: 'now' | 'soon' | 'gesture') => {
      live.current = next;
      if (paintQueued.current === null) {
        paintQueued.current = requestAnimationFrame(() => {
          paintQueued.current = null;
          paint();
        });
      }
      if (when === 'now') settle();
      else if (when === 'soon') {
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(settle, SETTLE_MS);
      }
    },
    [paint, settle],
  );

  const stop = useCallback(() => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
  }, []);

  const fly = useCallback(
    (next: AtlasView) => {
      stop();
      if (reducedMotion()) return moveTo(next, 'now');
      const from = live.current;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / FLY_MS);
        live.current = lerpView(from, next, t);
        paint();
        if (t < 1) anim.current = requestAnimationFrame(tick);
        else {
          anim.current = null;
          settle();
        }
      };
      anim.current = requestAnimationFrame(tick);
    },
    [stop, moveTo, paint, settle],
  );

  useEffect(
    () => () => {
      stop();
      if (paintQueued.current !== null) cancelAnimationFrame(paintQueued.current);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [stop],
  );

  // Measure the frame; open on the home view once, then only keep the view valid as it resizes.
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const aspect = width / height;
      frameRef.current = { width, aspect };
      setFrame(frameRef.current);
      live.current = moved.current ? clampView(live.current, aspect) : homeView(aspect, points, focus);
      setView(live.current);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    setReady(true);
    return () => ro.disconnect();
  }, [points, focus]);

  const { aspect, width } = frame;
  const vb = viewBox(view, aspect);
  const clusters = useMemo(() => clusterPoints(points, view.k, width, 30, TARGET), [points, view.k, width]);

  // Every render is at rest: draw it, then re-apply the live view in case a gesture is already moving on.
  useLayoutEffect(() => {
    paint();
  });

  const zoomBy = (factor: number) => {
    moved.current = true;
    fly(zoomAt(live.current, factor, frameRef.current.aspect));
  };
  const goHome = () => {
    moved.current = false;
    fly(homeView(frameRef.current.aspect, points, focus));
  };
  const goWorld = () => {
    moved.current = true;
    fly(worldView(frameRef.current.aspect, points));
  };

  // ---------------------------------------------------------------------------------- photos
  /**
   * Start loading postcard photos before they are asked for: a pin's when the pointer or focus
   * reaches it (so it is there when the postcard opens), the nearest few when the map comes to rest.
   * The postcards' <img>s are lazy and hidden; switching one to eager loads it with the srcset and
   * sizes it will be shown with, so the postcard reuses the very same response.
   */
  const warm = useCallback((ids: string[], priority: 'high' | 'low') => {
    for (const id of ids) {
      const img = root.current?.querySelector<HTMLImageElement>(`[data-atlas-entry="${CSS.escape(id)}"] img`);
      if (!img || (img.loading === 'eager' && priority === 'low')) continue;
      img.fetchPriority = priority;
      img.loading = 'eager';
    }
  }, []);

  useEffect(() => {
    if (!ready || constrained()) return;
    const { width: w, aspect: a } = frameRef.current;
    const box = viewBox(view, a);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const near = points
      .filter((p) => p.kind === 'pin' && p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h)
      .sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy))
      .slice(0, IDLE_WARM)
      .map((p) => p.id);
    if (!near.length || !w) return;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => warm(near, 'low'));
    return () => cancel(handle);
  }, [view, ready, points, warm]);

  // ---------------------------------------------------------------------------------- choosing
  /**
   * Open a postcard and hand it focus, so a screen reader reads what was opened. The page scrolls
   * only as far as it must to show the postcard (on a phone it sits under the map).
   */
  const reveal = useCallback(
    (id: string) => {
      warm([id], 'high');
      setChosen(id);
      requestAnimationFrame(() => {
        const card = root.current?.querySelector<HTMLElement>(`[data-atlas-entry="${CSS.escape(id)}"]`);
        card?.querySelector<HTMLElement>('[data-atlas-focus]')?.focus({ preventScroll: true });
        card?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      });
    },
    [warm],
  );

  const chooseCluster = (c: AtlasCluster<Point>) => {
    const [first] = c.members;
    if (!first) return;
    if (c.members.length === 1) return reveal(first.id);
    moved.current = true;
    // One place (or one block), several memories: zooming cannot part them, so each press opens the
    // next, the wedding's own card included when it shares the spot.
    if (inseparable(c.members, frameRef.current.width, 30, TARGET)) {
      const at = c.members.findIndex((m) => m.id === chosen);
      return reveal((c.members[(at + 1) % c.members.length] ?? first).id);
    }
    fly(fitView(c.members, frameRef.current.aspect, { pad: 0.3 }));
  };

  /** "Show on the map" from the ledger: fly to the pin, bring the map into view, open its postcard. */
  const showOnMap = useCallback(
    (id: string) => {
      const p = points.find((q) => q.id === id);
      if (!p) return;
      moved.current = true;
      const { aspect: a, width: w } = frameRef.current;
      // Close in around the venue; out in the world, only as deep as the world is drawn.
      let k = inRegion(p.x, p.y) ? Math.max(live.current.k, homeView(a, points, focus).k) : Math.min(Math.max(live.current.k, 6), WORLD_MAX_ZOOM);
      // Then deeper, until its pin stands on its own (or shares a spot no zoom can split).
      const deepest = inRegion(p.x, p.y) ? MAX_ZOOM : WORLD_MAX_ZOOM;
      const alone = (z: number) => {
        const mine = clusterPoints(points, z, w, 30, TARGET).find((c) => c.members.some((m) => m.id === id));
        return !mine || mine.members.length === 1 || inseparable(mine.members, w, 30, TARGET);
      };
      while (k < deepest && !alone(k)) k = Math.min(deepest, k * STEP);
      fly(clampView({ cx: p.x, cy: p.y, k }, a));
      canvas.current?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      warm([id], 'high');
      setChosen(id);
      requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-atlas-entry="${CSS.escape(id)}"] [data-atlas-focus]`)?.focus({ preventScroll: true }));
    },
    [points, focus, fly, warm],
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
  // Hovering or focusing a ledger row warms its photo too.
  const onRootPointerOver = (e: PointerEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-atlas-show]')?.dataset.atlasShow;
    if (id) warm([id], 'low');
  };

  // ---------------------------------------------------------------------------------- gestures
  type Press = { x: number; y: number; startX: number; startY: number };
  const pointers = useRef(new Map<number, Press>());
  const pinch = useRef<{ dist: number; view: AtlasView; mid: { x: number; y: number } } | null>(null);
  const dragging = useRef(false);
  /** Set when a drag or pinch ends, so the click the browser fires after it does not also open a pin. */
  const swallowClick = useRef(false);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // A primary pointer starts a new gesture: forget any press whose release never reached us, and
    // any click a drag was waiting to swallow. First, so a press on the zoom buttons counts too: a
    // touch drag is not followed by a click, and the next tap on "+" must not be taken for it.
    if (e.isPrimary) {
      pointers.current.clear();
      pinch.current = null;
      dragging.current = false;
      swallowClick.current = false;
    }
    if ((e.target as HTMLElement).closest('.bd-atlas__zoom')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = local(e);
    pointers.current.set(e.pointerId, { x: p.x, y: p.y, startX: p.x, startY: p.y });
    if (pointers.current.size === 2) {
      stop();
      const [a, b] = [...pointers.current.values()] as [Press, Press];
      pinch.current = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), view: live.current, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      for (const id of pointers.current.keys()) {
        try {
          e.currentTarget.setPointerCapture(id);
        } catch {
          // A pointer that has already gone cannot be captured; the pinch still reads its last position.
        }
      }
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = local(e);
    const { aspect: a } = frameRef.current;
    if (pinch.current && pointers.current.size >= 2) {
      pointers.current.set(e.pointerId, { ...prev, x: now.x, y: now.y });
      const [p, q] = [...pointers.current.values()] as [Press, Press];
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      moved.current = true;
      dragging.current = true;
      moveTo(zoomAt(pinch.current.view, dist / pinch.current.dist, a, pinch.current.mid.x / now.w, pinch.current.mid.y / now.h), 'gesture');
      return;
    }
    if (!dragging.current) {
      if (Math.hypot(now.x - prev.startX, now.y - prev.startY) < SLOP_PX) return;
      // One finger on a phone scrolls the page until the map is zoomed in; two always pinch.
      if (e.pointerType === 'touch' && live.current.k <= worldView(a, points).k + 0.01) return;
      dragging.current = true;
      stop();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Released between the event and the capture: the next move or release settles it.
      }
    }
    pointers.current.set(e.pointerId, { ...prev, x: now.x, y: now.y });
    moved.current = true;
    moveTo(panBy(live.current, now.x - prev.x, now.y - prev.y, now.w, a), 'gesture');
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pinch.current && pointers.current.size < 2) {
      pinch.current = null;
      // The finger left behind carries on as a drag from where it is now.
      for (const [id, p] of pointers.current) pointers.current.set(id, { ...p, startX: p.x, startY: p.y });
    }
    if (dragging.current && pointers.current.size === 0) {
      dragging.current = false;
      swallowClick.current = e.type === 'pointerup';
      settle();
    }
  };

  /**
   * Only the canvas losing its capture ends a press. A finger is captured implicitly by whatever it
   * lands on (a map layer, a pin's button); when a drag or pinch takes the capture for the canvas,
   * that element fires lostpointercapture, which bubbles here. Read as a release, it ended every
   * touch drag after its first move and dropped both fingers of a pinch.
   */
  const onLostCapture = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onPointerUp(e);
  };

  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    // `detail` is 0 for a click from the keyboard (Enter or Space on a pin), which no drag produced.
    if (!swallowClick.current || e.detail === 0) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const p = local(e);
    moved.current = true;
    fly(zoomAt(live.current, e.shiftKey ? 1 / STEP : STEP, frameRef.current.aspect, p.x / p.w, p.y / p.h));
  };

  // A plain wheel scrolls the page past the map; Ctrl/⌘ + wheel (and a trackpad pinch) zooms it.
  // A native listener, because React's is passive and the browser's own page zoom must be stopped.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      stop();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * r.height : e.deltaY;
      moved.current = true;
      moveTo(zoomAt(live.current, Math.exp(-dy * 0.01), frameRef.current.aspect, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height), 'soon');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [moveTo, stop]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = 80;
    const pan = (dx: number, dy: number) => {
      e.preventDefault();
      stop();
      moved.current = true;
      moveTo(panBy(live.current, dx, dy, frameRef.current.width, frameRef.current.aspect), 'soon');
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
      case '9':
      case 'End': e.preventDefault(); return goWorld();
    }
  };

  // ---------------------------------------------------------------------------------- drawing
  const home = homeView(aspect, points, focus);
  const world = worldView(aspect, points);
  // "Already there" within a hundredth of the frame. (A fixed half a drawing unit was the whole frame
  // at Chicago's scale, so after a pan most of a screen away "Back to Chicago" stayed disabled.)
  const near = (a: AtlasView, b: AtlasView) => Math.abs(a.k / b.k - 1) < 0.01 && Math.abs(a.cx - b.cx) < vb.w * 0.01 && Math.abs(a.cy - b.cy) < vb.h * 0.01;
  const atWorld = near(view, world);
  const atHome = near(view, home);
  const R = REGION;
  const height = width / aspect;
  const showLabels = view.k >= LABEL_ZOOM;
  const labelSides = placeLabels(clusters, chosen, showLabels, vb, width, aspect);
  const chosenCluster = clusters.find((c) => c.members.some((m) => m.id === chosen));

  const labelFor = (c: AtlasCluster<Point>) => {
    const m = c.members.length === 1 ? c.members[0] : undefined;
    if (m) {
      return m.kind === 'venue' ? `${m.title}, where we are getting married` : `${m.number}. ${m.title}`;
    }
    const names = c.members.map((m) => (m.kind === 'venue' ? 'our wedding' : m.title));
    if (inseparable(c.members, width, 30, TARGET)) return `${c.members.length} memories too close together to part: ${names.join(', ')}. Choose it again for the next one.`;
    return `${c.members.length} places close together: ${names.join(', ')}. Zoom in to see them.`;
  };

  const layer = (l: Layer, i: number) => (
    <use
      key={`${l.file}-${l.id}-${i}`}
      href={`${ATLAS_FILES[l.file]}#${l.id}`}
      className={l.className}
      data-layer=""
      data-k-min={l.kMin}
      data-k-max={l.kMax}
      data-detail={l.detail ? 'true' : undefined}
      data-off={layerOn(l, view.k, vb) ? undefined : ''}
    />
  );

  return (
    <div className="bd-atlas" ref={root} data-ready={ready ? 'true' : undefined} data-chosen={chosen ?? undefined} onClick={onRootClick} onPointerOver={onRootPointerOver}>
      <div className="bd-atlas__stage">
        <figure className="bd-atlas__map" aria-labelledby={`${uid}-caption`}>
          <div
            ref={canvas}
            className="bd-atlas__canvas"
            tabIndex={0}
            role="region"
            aria-roledescription="map"
            aria-label="Map of our adventures, opening on Chicago around the venue. Arrow keys move the map; plus and minus zoom; 0 comes back to the venue; 9 shows the whole world. The same adventures are listed below it."
            data-zoomed={view.k > world.k + 0.01 ? 'true' : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onLostPointerCapture={onLostCapture}
            onClickCapture={onClickCapture}
            onDoubleClick={onDoubleClick}
            onKeyDown={onKeyDown}
          >
            <svg ref={baseSvg} className="bd-atlas__svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
              <defs>
                {/* The world everywhere but the close-up's rectangle; the close-up only inside it. */}
                <clipPath id={`${clipId}-world`}>
                  <path clipRule="evenodd" d={`M0 0H${ATLAS_W}V${ATLAS_H}H0Z M${R.x} ${R.y}h${R.w}v${R.h}h${-R.w}Z`} />
                </clipPath>
                <clipPath id={`${clipId}-region`}>
                  <rect x={R.x} y={R.y} width={R.w} height={R.h} />
                </clipPath>
              </defs>
              {SKY.map(layer)}
              <g clipPath={`url(#${clipId}-world)`}>{WORLD.map(layer)}</g>
              <g clipPath={`url(#${clipId}-region)`} data-region="" data-off={regionInView(vb) ? undefined : ''}>
                {MIDWEST.map(layer)}
              </g>
            </svg>
            {/* The markers, drawn in screen pixels and moved by translate, so no zoom ever re-rasterizes them. */}
            <svg className="bd-atlas__pins" aria-hidden="true" focusable="false">
              {clusters.map((c) => {
                const single = c.members.length === 1 ? c.members[0] : null;
                const hasVenue = c.members.some((m) => m.kind === 'venue');
                const active = c === chosenCluster;
                const side = labelSides.get(c.id);
                const { sx, sy } = toScreen(c.x, c.y, vb, width);
                return (
                  <g
                    key={c.id}
                    className="bd-atlas__marker"
                    data-kind={single ? single.kind : 'cluster'}
                    data-active={active ? 'true' : undefined}
                    data-at={`${drawn(c.x)} ${drawn(c.y)} 0`}
                    data-off={within(sx, sy, width, height, MARGIN_PX) ? undefined : ''}
                    transform={`translate(${sx.toFixed(1)} ${sy.toFixed(1)})`}
                  >
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
                const single = c.members.length === 1 ? c.members[0] : null;
                const lift = liftOf(c.members);
                const { sx, sy } = toScreen(c.x, c.y, vb, width);
                const intent = () => warm(c.members.slice(0, 4).map((m) => m.id), 'low');
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="bd-atlas__target"
                    data-pin={single?.id}
                    data-at={`${drawn(c.x)} ${drawn(c.y)} ${lift}`}
                    data-off={within(sx, sy, width, height, TARGET_MARGIN_PX) ? undefined : ''}
                    style={{ transform: `translate(${sx.toFixed(1)}px, ${(sy - lift).toFixed(1)}px)` }}
                    aria-label={labelFor(c)}
                    aria-pressed={single ? chosen === single.id : undefined}
                    onPointerEnter={intent}
                    onFocus={(e: FocusEvent) => e.target === e.currentTarget && intent()}
                    onClick={() => chooseCluster(c)}
                  />
                );
              })}
            </div>
            <div className="bd-atlas__zoom" role="group" aria-label="Zoom">
              <button type="button" className="bd-atlas__zoombtn" onClick={() => zoomBy(STEP)} disabled={view.k >= MAX_ZOOM - 0.01 || clampView({ ...view, k: view.k * STEP }, aspect).k <= view.k + 0.01} aria-label="Zoom in">
                <svg className="bd-atlas__icon" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 4v12M4 10h12" />
                </svg>
              </button>
              <button type="button" className="bd-atlas__zoombtn" onClick={() => zoomBy(1 / STEP)} disabled={view.k <= MIN_ZOOM + 0.01} aria-label="Zoom out">
                <svg className="bd-atlas__icon" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M4 10h12" />
                </svg>
              </button>
              <button type="button" className="bd-atlas__zoombtn" onClick={goHome} disabled={atHome} aria-label="Back to Chicago and the venue">
                <svg className="bd-atlas__icon" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 3l7 7-7 7-7-7Z" />
                </svg>
              </button>
              <button type="button" className="bd-atlas__zoombtn" onClick={goWorld} disabled={atWorld} aria-label="Show the whole world">
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
            Drag to move. Zoom with + and −, a pinch, a double-click, or Ctrl (⌘ on a Mac) and scroll. Coastlines, lakes and roads from Natural Earth; Chicago’s lakefront and community areas from the City of Chicago.
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
