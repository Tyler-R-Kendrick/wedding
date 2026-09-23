import { ATLAS_FRAME } from './frame.generated';

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
 * Deep enough that Starved Rock and the hotel (130 km apart) part on a 390px phone; not so deep
 * that the 1:50m coastline, simplified to 0.12 units, turns visibly angular on a desktop.
 */
export const MAX_ZOOM = 24;
export const MIN_ZOOM = 1;

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

/** Keep the zoom in range and the frame on the drawing; a frame larger than the drawing centres it. */
export function clampView(view: AtlasView, aspect: number): AtlasView {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k));
  const { w, h } = viewBox({ ...view, k }, aspect);
  const axis = (c: number, span: number, total: number) => (span >= total ? total / 2 : Math.min(total - span / 2, Math.max(span / 2, c)));
  return { k, cx: axis(view.cx, w, ATLAS_W), cy: axis(view.cy, h, ATLAS_H) };
}

/**
 * Where the map opens. A wide frame shows the whole world. A squarer one (a phone) would shrink the
 * world to a strip, so it zooms until the drawing fills the frame's height and centres on the pins —
 * for a couple from Chicago that is the Americas and the Atlantic rather than a band of ocean.
 */
export function homeView(aspect: number, points: { x: number; y: number }[]): AtlasView {
  const k = Math.max(MIN_ZOOM, ATLAS_W / (ATLAS_H * aspect));
  const cx = k > 1 && points.length ? points.reduce((s, p) => s + p.x, 0) / points.length : ATLAS_W / 2;
  return clampView({ cx, cy: ATLAS_H / 2, k }, aspect);
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

/**
 * Pins closer than `radiusPx` on screen at zoom `k` are drawn as one numbered cluster. Greedy and
 * stable: points are taken in the order given (the ledger's order), each gathers the unclaimed
 * points within reach, and the cluster sits at its members' centre.
 */
export function clusterPoints<P extends AtlasPoint>(points: P[], k: number, frameWidthPx: number, radiusPx = 30): AtlasCluster<P>[] {
  const pxPerUnit = (frameWidthPx * k) / ATLAS_W;
  const r = radiusPx / pxPerUnit;
  const claimed = new Set<string>();
  const clusters: AtlasCluster<P>[] = [];
  for (const p of points) {
    if (claimed.has(p.id)) continue;
    const members = points.filter((q) => !claimed.has(q.id) && Math.hypot(q.x - p.x, q.y - p.y) <= r);
    for (const m of members) claimed.add(m.id);
    clusters.push({
      id: members.map((m) => m.id).join('+'),
      x: members.reduce((s, m) => s + m.x, 0) / members.length,
      y: members.reduce((s, m) => s + m.y, 0) / members.length,
      members,
    });
  }
  return clusters;
}

/** True when these points cannot be told apart even at the deepest zoom (one place, several memories). */
export function inseparable(points: { x: number; y: number }[], frameWidthPx: number, radiusPx = 30): boolean {
  const pxPerUnit = (frameWidthPx * MAX_ZOOM) / ATLAS_W;
  return points.every((p) => points.every((q) => Math.hypot(p.x - q.x, p.y - q.y) * pxPerUnit < radiusPx));
}
