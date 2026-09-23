import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adventureCoordinates } from '@/domain/adventures/repo';
import { ATLAS_FRAME, ATLAS_LAYERS } from '@/themes/shared/atlas/frame.generated';
import { ATLAS_H, ATLAS_W, MAX_ZOOM, clampView, clusterPoints, fitView, homeView, inseparable, lerpView, panBy, project, viewBox, zoomAt } from '@/themes/shared/atlas/projection';

const WIDE = ATLAS_W / ATLAS_H;
const PHONE = 5 / 4;
const chicago = project(41.8815, -87.6246);
const starvedRock = project(41.3214, -88.9903);

describe('the atlas projection', () => {
  it('puts the prime meridian and the equator where Equal Earth does', () => {
    const origin = project(0, 0);
    expect(origin.x).toBeCloseTo(ATLAS_W / 2, 6);
    expect(origin.y).toBeCloseTo(ATLAS_FRAME.top, 6);
    // The antimeridian is the drawing's edge.
    expect(project(0, 180).x).toBeCloseTo(ATLAS_W, 3);
    expect(project(0, -180).x).toBeCloseTo(0, 3);
  });

  it('keeps north up and west left', () => {
    expect(project(60, 0).y).toBeLessThan(project(-30, 0).y);
    expect(project(0, -90).x).toBeLessThan(project(0, 90).x);
    // Chicago is in the north-west quarter of the drawing.
    expect(chicago.x).toBeLessThan(ATLAS_W / 2);
    expect(chicago.y).toBeLessThan(ATLAS_FRAME.top);
  });

  it('clamps latitudes outside the drawn frame onto its edge', () => {
    expect(project(-89, 0).y).toBeCloseTo(project(ATLAS_FRAME.south, 0).y, 6);
    expect(project(ATLAS_FRAME.south, 0).y).toBeCloseTo(ATLAS_H, 0);
  });

  it('matches the world file the generator wrote', () => {
    const svg = readFileSync(join(process.cwd(), 'public/assets/atlas/world.svg'), 'utf8');
    expect(svg).toContain(`viewBox="0 0 ${ATLAS_FRAME.width} ${ATLAS_FRAME.height}"`);
    for (const layer of ATLAS_LAYERS) expect(svg).toMatch(new RegExp(`<path id="${layer}" vector-effect="non-scaling-stroke" d="M`));
    // The page colours every layer through <use>; paint in the file would override the theme.
    expect(svg).not.toMatch(/\b(fill|stroke)="/);
  });
});

describe('atlas views', () => {
  it('opens on the whole world in a wide frame', () => {
    const v = homeView(WIDE, [chicago]);
    expect(v).toEqual({ cx: ATLAS_W / 2, cy: ATLAS_H / 2, k: 1 });
  });

  it('fills a phone frame top to bottom and centres on the pins', () => {
    const v = homeView(PHONE, [chicago, starvedRock]);
    const vb = viewBox(v, PHONE);
    expect(vb.h).toBeCloseTo(ATLAS_H, 6);
    expect(vb.x).toBeLessThanOrEqual(chicago.x);
    expect(vb.x + vb.w).toBeGreaterThanOrEqual(chicago.x);
  });

  it('never lets the frame leave the drawing', () => {
    const v = clampView({ cx: -500, cy: 9000, k: 4 }, WIDE);
    const vb = viewBox(v, WIDE);
    expect(vb.x).toBeGreaterThanOrEqual(0);
    expect(vb.y + vb.h).toBeLessThanOrEqual(ATLAS_H + 1e-9);
    expect(clampView({ cx: 0, cy: 0, k: 100 }, WIDE).k).toBe(MAX_ZOOM);
    expect(clampView({ cx: 0, cy: 0, k: 0.1 }, WIDE).k).toBe(1);
  });

  it('zooms about the point under the cursor', () => {
    const start = clampView({ cx: 400, cy: 200, k: 2 }, WIDE);
    const before = viewBox(start, WIDE);
    const fx = 0.25, fy = 0.4;
    const under = { x: before.x + fx * before.w, y: before.y + fy * before.h };
    const after = viewBox(zoomAt(start, 2, WIDE, fx, fy), WIDE);
    expect(after.x + fx * after.w).toBeCloseTo(under.x, 6);
    expect(after.y + fy * after.h).toBeCloseTo(under.y, 6);
    expect(after.w).toBeCloseTo(before.w / 2, 6);
  });

  it('pans by screen pixels, opposite to the drag', () => {
    const start = clampView({ cx: 500, cy: 200, k: 4 }, WIDE);
    const moved = panBy(start, 100, 0, 1000, WIDE);
    expect(moved.cx).toBeCloseTo(start.cx - (100 * ATLAS_W) / 4 / 1000, 6);
  });

  it('fits a set of pins, and a single pin no closer than the deepest zoom', () => {
    const v = fitView([chicago, starvedRock], WIDE);
    const vb = viewBox(v, WIDE);
    for (const p of [chicago, starvedRock]) {
      expect(p.x).toBeGreaterThan(vb.x);
      expect(p.x).toBeLessThan(vb.x + vb.w);
    }
    expect(fitView([chicago], WIDE).k).toBe(MAX_ZOOM);
  });

  it('interpolates from one view to the other', () => {
    const a = { cx: 100, cy: 100, k: 1 }, b = { cx: 300, cy: 200, k: 8 };
    expect(lerpView(a, b, 0)).toEqual(a);
    const end = lerpView(a, b, 1);
    expect(end.cx).toBeCloseTo(300, 9);
    expect(end.k).toBeCloseTo(8, 9);
  });
});

describe('atlas clusters', () => {
  const pts = [
    { id: 'caa', ...chicago },
    { id: 'rock', ...starvedRock },
    { id: 'paris', ...project(48.8566, 2.3522) },
  ];

  it('merges Chicago and Starved Rock on the whole world, and parts them close in', () => {
    const world = clusterPoints(pts, 1, 1000);
    expect(world.map((c) => c.members.map((m) => m.id))).toEqual([['caa', 'rock'], ['paris']]);
    const close = clusterPoints(pts, MAX_ZOOM, 1000);
    expect(close).toHaveLength(3);
  });

  it('places a cluster at its members’ centre and keeps the ledger order', () => {
    const [c] = clusterPoints(pts, 1, 1000);
    if (!c) throw new Error('no cluster');
    expect(c.id).toBe('caa+rock');
    expect(c.x).toBeCloseTo((chicago.x + starvedRock.x) / 2, 9);
  });

  it('knows when two memories share one place', () => {
    expect(inseparable([chicago, { ...chicago }], 1000)).toBe(true);
    expect(inseparable([chicago, starvedRock], 1000)).toBe(false);
  });
});

describe('where an adventure is pinned', () => {
  it('prefers the memory’s own coordinates, then its place’s', () => {
    expect(adventureCoordinates({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })).toEqual({ lat: 1, lng: 2 });
    expect(adventureCoordinates({ lat: null, lng: null }, { lat: 3, lng: 4 })).toEqual({ lat: 3, lng: 4 });
  });

  it('never pins half a coordinate or an impossible one', () => {
    expect(adventureCoordinates({ lat: 41, lng: null }, { lat: null, lng: null })).toBeUndefined();
    expect(adventureCoordinates({ lat: 41, lng: null }, { lat: 3, lng: 4 })).toEqual({ lat: 3, lng: 4 });
    expect(adventureCoordinates({ lat: 91, lng: 0 })).toBeUndefined();
    expect(adventureCoordinates({ lat: Number.NaN, lng: 0 })).toBeUndefined();
    expect(adventureCoordinates({ lat: null, lng: null })).toBeUndefined();
  });
});
