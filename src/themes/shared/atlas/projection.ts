import { ATLAS_FRAME } from './frame.generated';
import { REGION_FRAME } from './region.generated';

/*
 * The atlas under Our Adventures, as plain math: where a latitude and longitude land on the drawing,
 * which part of the drawing a view shows, and which pins sit too close to tell apart at a zoom.
 * No DOM and no React, so every rule here is unit-tested and the component only wires events to it.
 *
 * Coordinates are drawing units: the world is ATLAS_FRAME.width (1000) wide on Equal Earth, the
 * same projection scripts/generate-atlas.mjs drew public/assets/atlas/world.svg with.
 */

export const ATLAS_W = ATLAS_FRAME.width;
export const ATLAS_H = ATLAS_FRAME.height;
/**
 * Out in the world: deep enough that Starved Rock and the hotel (130 km apart) part on a 390px
 * phone; not so deep that the 1:50m coastline, simplified to 0.12 units, turns visibly angular.
 */
export const WORLD_MAX_ZOOM = 24;
/**
 * Inside the Midwest close-up (midwest.svg: 1:10m lakes and roads, the City of Chicago's own
 * lakefront): street scale, where two restaurants a block apart in Fulton Market part on a phone.
 */
export const MAX_ZOOM = 15000;
export const MIN_ZOOM = 1;
/** The close-up's rectangle in drawing units; the world is drawn outside it and midwest.svg inside. */
export const REGION = REGION_FRAME;

/** True when a drawing point lies inside the close-up. */
export const inRegion = (x: number, y: number) => x >= REGION.x && x <= REGION.x + REGION.w && y >= REGION.y && y <= REGION.y + REGION.h;

const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;

/** Equal Earth (Šavrič, Patterson & Jenny, 2018), scaled and flipped into the drawing. */
export function project(lat: number, lng: number): { x: number; y: number } {
  const l = (lng * Math.PI) / 180;
  const p = (Math.max(ATLAS_FRAME.south, Math.min(ATLAS_FRAME.north, lat)) * Math.PI) / 180;
  const t = Math.asin(M * Math.sin(p));
  const t2 = t * t, t6 = t2 * t2 * t2;
  const x = (l * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return { x: x * ATLAS_FRAME.scale + ATLAS_W / 2, y: ATLAS_FRAME.top - y * ATLAS_FRAME.scale };
}

/** A view: the drawing point at the middle of the frame, and how far in. */
export interface AtlasView {
  cx: number;
  cy: number;
  k: number;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * At k = 1 the whole width of the world fits the frame. `aspect` is the frame's width over its
 * height, so a squarer phone frame shows the full height of the drawing and less of its width.
 */
export function viewBox(view: AtlasView, aspect: number): ViewBox {
  const w = ATLAS_W / view.k;
  const h = w / aspect;
  return { x: view.cx - w / 2, y: view.cy - h / 2, w, h };
}

/**
 * Keep the zoom in range and the frame on the drawing; a frame larger than the drawing centres it.
 * Past the world's own depth the close-up must stay in view: a frame small enough to fit inside it is
 * held inside it (the only part drawn finely enough to look at from there), and a larger one may
 * roam only as far as still overlaps it, so zooming in near its edge neither jumps nor locks the
 * pan. A frame nowhere near the close-up stops at the world's depth.
 */
export function clampView(view: AtlasView, aspect: number): AtlasView {
  // "Near" is judged by the frame, not its centre, so a drag that nudges the centre past the
  // close-up's edge is held at the edge rather than dropped back out to the world's depth.
  const asked = viewBox(view, aspect);
  const deep = view.k > WORLD_MAX_ZOOM && asked.x < REGION.x + REGION.w && REGION.x < asked.x + asked.w && asked.y < REGION.y + REGION.h && REGION.y < asked.y + asked.h;
  const k = Math.min(deep ? MAX_ZOOM : WORLD_MAX_ZOOM, Math.max(MIN_ZOOM, view.k));
  const { w, h } = viewBox({ ...view, k }, aspect);
  const axis = (c: number, span: number, start: number, total: number) => (span >= total ? start + total / 2 : Math.min(start + total - span / 2, Math.max(start + span / 2, c)));
  const onDrawing = (c: number, span: number, total: number) => axis(c, span, 0, total);
  if (!deep) return { k, cx: onDrawing(view.cx, w, ATLAS_W), cy: onDrawing(view.cy, h, ATLAS_H) };
  /** Inside the close-up when the frame fits it on this axis; otherwise overlapping it, and on the drawing. */
  const held = (c: number, span: number, start: number, total: number, drawing: number) =>
    span <= total ? axis(c, span, start, total) : onDrawing(Math.min(start + total + span / 2, Math.max(start - span / 2, c)), span, drawing);
  return { k, cx: held(view.cx, w, REGION.x, REGION.w, ATLAS_W), cy: held(view.cy, h, REGION.y, REGION.h, ATLAS_H) };
}

/**
 * The whole world. A wide frame shows all of it. A squarer one (a phone) would shrink the world to a
 * strip, so it zooms until the drawing fills the frame's height and centres on the pins — for a
 * couple from Chicago that is the Americas and the Atlantic rather than a band of ocean.
 */
export function worldView(aspect: number, points: { x: number; y: number }[]): AtlasView {
  const k = Math.max(MIN_ZOOM, ATLAS_W / (ATLAS_H * aspect));
  const cx = k > 1 && points.length ? points.reduce((s, p) => s + p.x, 0) / points.length : ATLAS_W / 2;
  return clampView({ cx, cy: ATLAS_H / 2, k }, aspect);
}

/** Drawing units per kilometre east–west at a latitude (Equal Earth is equal-area, so this varies). */
export function unitsPerKm(lat: number): number {
  const a = project(lat, 0), b = project(lat, 1);
  return (b.x - a.x) / (111.32 * Math.cos((lat * Math.PI) / 180));
}

export interface AtlasFocus {
  x: number;
  y: number;
  /** Pins within this many drawing units of the focus are framed with it. */
  reach: number;
  /** The frame never shows less than this many drawing units across, however close the pins. */
  minSpan: number;
}

/**
 * Where the map opens. With a focus (the wedding), the frame is the focus and every pin within its
 * reach, so a guest lands on the neighbourhoods around the venue rather than a whole planet; the
 * rest of the world is a zoom-out away. Without one, the whole world.
 */
export function homeView(aspect: number, points: { x: number; y: number }[], focus?: AtlasFocus): AtlasView {
  if (!focus) return worldView(aspect, points);
  const near = points.filter((p) => Math.hypot(p.x - focus.x, p.y - focus.y) <= focus.reach);
  return fitView([focus, ...near], aspect, { pad: 0.12, maxK: ATLAS_W / focus.minSpan });
}

/** The closest view that shows every point with `pad` (a fraction of the frame) to spare. */
export function fitView(points: { x: number; y: number }[], aspect: number, opts: { pad?: number; maxK?: number } = {}): AtlasView {
  const pad = opts.pad ?? 0.2;
  const maxK = opts.maxK ?? MAX_ZOOM;
  if (!points.length) return clampView({ cx: ATLAS_W / 2, cy: ATLAS_H / 2, k: 1 }, aspect);
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const spanW = Math.max(x1 - x0, 1e-6) / (1 - 2 * pad);
  const spanH = Math.max(y1 - y0, 1e-6) / (1 - 2 * pad);
  const k = Math.min(maxK, ATLAS_W / spanW, (ATLAS_W / aspect) / spanH);
  return clampView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k }, aspect);
}

/** Zoom by `factor` keeping the drawing point under (fx, fy) — fractions of the frame — where it is. */
export function zoomAt(view: AtlasView, factor: number, aspect: number, fx = 0.5, fy = 0.5): AtlasView {
  const before = viewBox(view, aspect);
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
  const px = before.x + fx * before.w, py = before.y + fy * before.h;
  const w = ATLAS_W / k, h = w / aspect;
  return clampView({ k, cx: px - (fx - 0.5) * w, cy: py - (fy - 0.5) * h }, aspect);
}

/** Move the frame by a distance in screen pixels, given the frame's width in pixels. */
export function panBy(view: AtlasView, dxPx: number, dyPx: number, frameWidthPx: number, aspect: number): AtlasView {
  const unitsPerPx = ATLAS_W / view.k / frameWidthPx;
  return clampView({ ...view, cx: view.cx - dxPx * unitsPerPx, cy: view.cy - dyPx * unitsPerPx }, aspect);
}

/** Eased interpolation between two views; zoom moves in log space so it feels even at every depth. */
export function lerpView(a: AtlasView, b: AtlasView, t: number): AtlasView {
  const e = 1 - Math.pow(1 - t, 3);
  return { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, k: Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * e) };
}

export interface AtlasPoint {
  id: string;
  x: number;
  y: number;
}

export interface AtlasCluster<P extends AtlasPoint> {
  id: string;
  x: number;
  y: number;
  members: P[];
}

export interface TargetRule<P extends AtlasPoint> {
  /** The side of the square button each marker carries, in screen pixels (44: WCAG's comfortable target). */
  sizePx: number;
  /** How far above its point a marker's button sits (a pin's head is above its tip), in screen pixels. */
  lift?: (members: P[]) => number;
}

/**
 * Pins closer than `radiusPx` on screen at zoom `k` are drawn as one numbered cluster. Greedy and
 * stable: points are taken in the order given (the ledger's order), each gathers the unclaimed
 * points within reach, and the cluster sits at its members' centre. With a `target` rule, clusters
 * whose buttons would overlap are then merged too, so no button ever covers part of another.
 */
export function clusterPoints<P extends AtlasPoint>(points: P[], k: number, frameWidthPx: number, radiusPx = 30, target?: TargetRule<P>): AtlasCluster<P>[] {
  const pxPerUnit = (frameWidthPx * k) / ATLAS_W;
  const r = radiusPx / pxPerUnit;
  const claimed = new Set<string>();
  const make = (members: P[]): AtlasCluster<P> => ({
    id: members.map((m) => m.id).join('+'),
    x: members.reduce((s, m) => s + m.x, 0) / members.length,
    y: members.reduce((s, m) => s + m.y, 0) / members.length,
    members,
  });
  let clusters: AtlasCluster<P>[] = [];
  for (const p of points) {
    if (claimed.has(p.id)) continue;
    const members = points.filter((q) => !claimed.has(q.id) && Math.hypot(q.x - p.x, q.y - p.y) <= r);
    for (const m of members) claimed.add(m.id);
    clusters.push(make(members));
  }
  if (!target) return clusters;
  const lift = target.lift ?? (() => 0);
  const clash = (a: AtlasCluster<P>, b: AtlasCluster<P>) =>
    Math.abs(a.x - b.x) * pxPerUnit < target.sizePx && Math.abs((a.y - b.y) * pxPerUnit - (lift(a.members) - lift(b.members))) < target.sizePx;
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (!clash(clusters[i]!, clusters[j]!)) continue;
        const joined = make([...clusters[i]!.members, ...clusters[j]!.members]);
        clusters = [...clusters.slice(0, i), joined, ...clusters.slice(i + 1, j), ...clusters.slice(j + 1)];
        merged = true;
        break outer;
      }
    }
  }
  return clusters;
}

/** True when these points cannot be told apart even at the deepest zoom (one place, several memories). */
export function inseparable<P extends AtlasPoint>(points: P[], frameWidthPx: number, radiusPx = 30, target?: TargetRule<P>): boolean {
  const deepest = points.every((p) => inRegion(p.x, p.y)) ? MAX_ZOOM : WORLD_MAX_ZOOM;
  return clusterPoints(points, deepest, frameWidthPx, radiusPx, target).length === 1;
}
