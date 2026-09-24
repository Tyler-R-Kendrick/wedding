import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adventureCoordinates } from '@/domain/adventures/repo';
import { ATLAS_FRAME, ATLAS_LAYERS } from '@/themes/shared/atlas/frame.generated';
import { ATLAS_FILES, WORLD_VERSION } from '@/themes/shared/atlas/files';
import { MIDWEST, SKY, WORLD, insideRegion, layerOn } from '@/themes/shared/atlas/layers';
import { REGION_FRAME, REGION_LAYERS, REGION_VERSION } from '@/themes/shared/atlas/region.generated';
import { photoSrcSet } from '@/themes/shared/photos';
import { ATLAS_H, ATLAS_W, MAX_ZOOM, WORLD_MAX_ZOOM, clampView, clusterPoints, fitView, homeView, inRegion, inseparable, lerpView, panBy, project, unitsPerKm, viewBox, worldView, zoomAt } from '@/themes/shared/atlas/projection';

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
    expect(clampView({ cx: 0, cy: 0, k: 100 }, WIDE).k).toBe(WORLD_MAX_ZOOM);
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
    expect(inseparable([{ id: 'a', ...chicago }, { id: 'b', ...chicago }], 1000)).toBe(true);
    expect(inseparable([{ id: 'a', ...chicago }, { id: 'b', ...starvedRock }], 1000)).toBe(false);
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

describe('the Midwest close-up', () => {
  const venue = chicago;
  const u = unitsPerKm(41.8815);
  const focus = { ...venue, reach: 16 * u, minSpan: 9 * u };
  const alinea = project(41.9134, -87.6481);
  const wrigley = project(41.9474, -87.656);
  const copenhagen = project(55.6825, 12.6108);

  it('covers the venue, Starved Rock and Door County, and matches the file the generator wrote', () => {
    for (const p of [venue, starvedRock, project(44.9, -87.39)]) expect(inRegion(p.x, p.y)).toBe(true);
    // With room to spare: its west edge once ran 0.03° from Starved Rock, and the map was blank beyond it.
    const west = project(41.3214, -88.9903 - 1.5);
    expect(inRegion(west.x, west.y)).toBe(true);
    expect(inRegion(copenhagen.x, copenhagen.y)).toBe(false);
    const svg = readFileSync(join(process.cwd(), 'public/assets/atlas/midwest.svg'), 'utf8');
    expect(svg).toContain(`viewBox="${REGION_FRAME.x} ${REGION_FRAME.y} ${REGION_FRAME.w} ${REGION_FRAME.h}"`);
    for (const layer of REGION_LAYERS) expect(svg).toMatch(new RegExp(`<path id="${layer}" vector-effect="non-scaling-stroke" d="M`));
    expect(svg).not.toMatch(/\b(fill|stroke)="/);
  });

  it('opens on the venue and the pins around it, not the whole world', () => {
    for (const aspect of [WIDE, PHONE]) {
      const v = homeView(aspect, [alinea, wrigley, starvedRock, copenhagen], focus);
      const vb = viewBox(v, aspect);
      for (const p of [venue, alinea, wrigley]) {
        expect(p.x).toBeGreaterThan(vb.x);
        expect(p.x).toBeLessThan(vb.x + vb.w);
        expect(p.y).toBeGreaterThan(vb.y);
        expect(p.y).toBeLessThan(vb.y + vb.h);
      }
      // Starved Rock (130 km) and Copenhagen are a zoom-out away.
      expect(starvedRock.x < vb.x || starvedRock.y > vb.y + vb.h).toBe(true);
      expect(vb.w / u).toBeLessThan(40);
      expect(vb.w / u).toBeGreaterThanOrEqual(9 - 1e-6);
    }
    // Without a focus it is still the world.
    expect(homeView(WIDE, [venue])).toEqual(worldView(WIDE, [venue]));
  });

  it('zooms to street scale inside the close-up and holds the frame there; elsewhere stops at the world depth', () => {
    const deep = clampView({ cx: venue.x, cy: venue.y, k: 1e6 }, WIDE);
    expect(deep.k).toBe(MAX_ZOOM);
    // ~2.8 km across at the deepest zoom.
    expect(viewBox(deep, WIDE).w / u).toBeLessThan(3);
    const dragged = viewBox(clampView({ cx: REGION_FRAME.x - 0.1, cy: venue.y, k: 1000 }, WIDE), WIDE);
    expect(dragged.x).toBeGreaterThanOrEqual(REGION_FRAME.x - 1e-9);
    expect(clampView({ cx: copenhagen.x, cy: copenhagen.y, k: 1000 }, WIDE).k).toBe(WORLD_MAX_ZOOM);
  });

  it('zooming in near the edge of the close-up neither jumps nor locks the pan', () => {
    const edge = project(42.28, -83.74); // Ann Arbor, just inside the close-up's east edge
    const before = clampView({ cx: edge.x, cy: edge.y, k: WORLD_MAX_ZOOM }, WIDE);
    const after = zoomAt(before, 1.8, WIDE);
    expect(after.k).toBeCloseTo(WORLD_MAX_ZOOM * 1.8, 6);
    expect(after.cx).toBeCloseTo(before.cx, 6);
    expect(after.cy).toBeCloseTo(before.cy, 6);
    // A frame wider than the close-up still pans (it only has to keep the close-up in view).
    const wide = clampView({ cx: venue.x, cy: venue.y, k: 60 }, WIDE);
    const moved = panBy(wide, -100, 0, 1000, WIDE);
    expect(moved.k).toBe(60);
    expect(moved.cx).toBeGreaterThan(wide.cx);
  });

  it('parts places a few blocks apart on a phone, but not three photos from one table', () => {
    const ever = { id: 'ever', ...project(41.88658, -87.66048) }, riverWest = { id: 'rw', ...project(41.89, -87.66) };
    expect(inseparable([ever, riverWest], 390, 30, { sizePx: 44 })).toBe(false);
    const table = [project(41.91344, -87.64817), project(41.91349, -87.64808), project(41.91342, -87.64795)].map((p, i) => ({ id: `t${i}`, ...p }));
    expect(inseparable(table, 390)).toBe(true);
    // Out in the world, "inseparable" still means at the world's own depth.
    expect(inseparable([{ id: 'a', ...copenhagen }, { id: 'b', ...project(55.6737, 12.5699) }], 390)).toBe(true);
  });

  it("merges markers whose 44px buttons would overlap, so none is partly covered", () => {
    const pts = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 0.036, y: 0 }, // 36px apart at k = 1000 on a 1000px frame: outside 30px, inside 44px
      { id: 'c', x: 0.2, y: 0 },
    ];
    expect(clusterPoints(pts, 1000, 1000).length).toBe(3);
    const merged = clusterPoints(pts, 1000, 1000, 30, { sizePx: 44 });
    expect(merged.map((c) => c.members.map((m) => m.id).join(''))).toEqual(['ab', 'c']);
    // A pin's button is lifted 14px onto its head: 36px above a cluster its button clears the
    // cluster's; 36px below, it lands 22px from it and the two merge.
    const lift = (m: { id: string }[]) => (m.length === 1 && m[0]!.id !== 'k' ? 14 : 0);
    expect(clusterPoints([{ id: 'k', x: 0, y: 0 }, { id: 'p', x: 0, y: -0.036 }], 1000, 1000, 30, { sizePx: 44, lift }).length).toBe(2);
    expect(clusterPoints([{ id: 'k', x: 0, y: 0 }, { id: 'p', x: 0, y: 0.036 }], 1000, 1000, 30, { sizePx: 44, lift }).length).toBe(1);
  });
});

describe('what the atlas draws at each depth', () => {
  const u = unitsPerKm(41.8815);
  const focus = { ...chicago, reach: 16 * u, minSpan: 9 * u };
  const on = (layers: typeof SKY, id: string, className: string, v: { cx: number; cy: number; k: number }, aspect = WIDE) =>
    layerOn(layers.find((l) => l.id === id && l.className === className)!, v.k, viewBox(v, aspect));

  it('draws the world-long dashed lines only while the whole world is in reach', () => {
    const world = worldView(WIDE, [chicago]);
    const home = homeView(WIDE, [chicago], focus);
    for (const id of ['graticule', 'tropics', 'equator']) {
      const layer = SKY.find((l) => l.id === id)!;
      expect(on(SKY, id, layer.className, world), id).toBe(true);
      // Chicago's default view: the tropics cost ~230 ms a frame there, drawn off screen.
      expect(on(SKY, id, layer.className, home), id).toBe(false);
    }
  });

  it('stops dashing state lines at street scale', () => {
    const street = clampView({ cx: chicago.x, cy: chicago.y, k: MAX_ZOOM }, WIDE);
    expect(on(MIDWEST, 'states', 'bd-atlas__states', { ...street, k: 1000 })).toBe(true);
    expect(on(MIDWEST, 'states', 'bd-atlas__states', street)).toBe(false);
    expect(on(WORLD, 'states', 'bd-atlas__states', street)).toBe(false);
  });

  it('draws roads and rivers only where they fill the frame, so they never end in a seam', () => {
    for (const aspect of [WIDE, PHONE]) {
      // Starved Rock at a county's scale: detail on both sides of it.
      const rock = clampView({ cx: starvedRock.x, cy: starvedRock.y, k: 300 }, aspect);
      expect(insideRegion(viewBox(rock, aspect))).toBe(true);
      expect(on(MIDWEST, 'roads', 'bd-atlas__roads', rock, aspect)).toBe(true);
      // A frame wider than the close-up would show the roads stop at its edge: none are drawn.
      const wide = clampView({ cx: chicago.x, cy: chicago.y, k: 30 }, aspect);
      expect(insideRegion(viewBox(wide, aspect))).toBe(false);
      expect(on(MIDWEST, 'roads', 'bd-atlas__roads', wide, aspect)).toBe(false);
      expect(on(MIDWEST, 'rivers', 'bd-atlas__rivers', wide, aspect)).toBe(false);
    }
  });

  it('addresses both map files by their content, so a cached copy never outlives its frame', () => {
    const hash = (f: string) => createHash('sha256').update(readFileSync(join(process.cwd(), 'public/assets/atlas', f))).digest('hex').slice(0, 12);
    expect(WORLD_VERSION, 'world.svg changed: update WORLD_VERSION in src/themes/shared/atlas/files.ts').toBe(hash('world.svg'));
    expect(REGION_VERSION, 'midwest.svg changed without scripts/generate-atlas-region.mjs').toBe(hash('midwest.svg'));
    expect(ATLAS_FILES.world).toBe(`/assets/atlas/world.svg?v=${WORLD_VERSION}`);
    expect(ATLAS_FILES.midwest).toBe(`/assets/atlas/midwest.svg?v=${REGION_VERSION}`);
  });
});

describe('postcard photos', () => {
  it('offer the 800px copy beside the original, at their real widths', () => {
    expect(photoSrcSet('/assets/photos/adventures/noma-2025-06-24.webp')).toMatch(/^\/assets\/photos\/adventures\/800\/noma-2025-06-24\.webp 800w, \/assets\/photos\/adventures\/noma-2025-06-24\.webp \d+w$/);
    expect(photoSrcSet('/assets/commons/some-hotel.jpg')).toBeUndefined();
    expect(photoSrcSet('/assets/photos/adventures/not-a-photo.webp')).toBeUndefined();
  });
});
