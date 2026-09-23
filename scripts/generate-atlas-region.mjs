#!/usr/bin/env node
// The close-up drawn under Our Adventures once the atlas is zoomed past the world's scale: Lake
// Michigan's shore, the Midwest's lakes, rivers, interstates and towns at Natural Earth's 1:10m, and
// the City of Chicago itself (its 77 community areas, whose edges are the true lakeshore). Same
// Equal Earth projection and drawing units as world.svg, so a pin, the world and this close-up can
// never disagree about where a place is.
//
//   node scripts/generate-atlas-region.mjs                  # fetch the sources from jsDelivr
//   node scripts/generate-atlas-region.mjs <dir-of-geojson> # or read them from disk
//
// Output: public/assets/atlas/midwest.svg (one <path id> per layer, no paint) and the region's frame
// in src/themes/shared/atlas/region.generated.ts. The page draws the world outside the frame and this
// file inside it (AdventureAtlas clips each to its side), so the 1:50m and 1:10m coastlines never
// overlap. Natural Earth is public domain; the community areas are the City of Chicago's open data.
// Both are recorded in docs/ops/asset-licensing.md.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outSvg = join(root, 'public', 'assets', 'atlas', 'midwest.svg');
const outFrame = join(root, 'src', 'themes', 'shared', 'atlas', 'region.generated.ts');
// The world's frame, as generate-atlas.mjs wrote it: read, not re-derived, so the two files cannot drift.
const ATLAS_FRAME = JSON.parse((await readFile(join(root, 'src', 'themes', 'shared', 'atlas', 'frame.generated.ts'), 'utf8')).match(/ATLAS_FRAME = (\{.*?\}) as const/)[1]);
const NE = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson';
const SOURCES = {
  ne_10m_land: `${NE}/ne_10m_land.geojson`,
  ne_10m_lakes: `${NE}/ne_10m_lakes.geojson`,
  ne_10m_lakes_north_america: `${NE}/ne_10m_lakes_north_america.geojson`,
  ne_10m_rivers_lake_centerlines: `${NE}/ne_10m_rivers_lake_centerlines.geojson`,
  ne_10m_rivers_north_america: `${NE}/ne_10m_rivers_north_america.geojson`,
  ne_10m_roads: `${NE}/ne_10m_roads.geojson`,
  ne_10m_urban_areas: `${NE}/ne_10m_urban_areas.geojson`,
  ne_10m_admin_1_states_provinces_lines: `${NE}/ne_10m_admin_1_states_provinces_lines.geojson`,
  // City of Chicago "Boundaries - Community Areas", as mirrored in a public repository.
  'chicago-community-areas': 'https://cdn.jsdelivr.net/gh/RandomFractals/ChicagoCrimes@master/data/chicago-community-areas.geojson',
};

/** The close-up covers Lake Michigan whole, from Madison to Door County to the Indiana dunes. */
const BOX = { west: -93, east: -83, south: 40, north: 47.5 };

// ------------------------------------------------------------------------------ projection
// Equal Earth, scaled into the world drawing exactly as generate-atlas.mjs and projection.ts do.
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
function project([lng, lat]) {
  const l = (lng * Math.PI) / 180, p = (lat * Math.PI) / 180;
  const t = Math.asin(M * Math.sin(p)), t2 = t * t, t6 = t2 * t2 * t2;
  const x = (l * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x * ATLAS_FRAME.scale + ATLAS_FRAME.width / 2, ATLAS_FRAME.top - y * ATLAS_FRAME.scale];
}

/**
 * The frame: the largest upright rectangle inside the box once projected (Equal Earth bends the
 * meridians, so the box's projected sides lean). Everything drawn here is clipped to it on the page.
 */
function frameOf(box) {
  const lats = Array.from({ length: 31 }, (_, i) => box.south + ((box.north - box.south) * i) / 30);
  const lngs = Array.from({ length: 31 }, (_, i) => box.west + ((box.east - box.west) * i) / 30);
  const x0 = Math.max(...lats.map((lat) => project([box.west, lat])[0]));
  const x1 = Math.min(...lats.map((lat) => project([box.east, lat])[0]));
  const y0 = Math.max(...lngs.map((lng) => project([lng, box.north])[1]));
  const y1 = Math.min(...lngs.map((lng) => project([lng, box.south])[1]));
  const r = (v) => Math.round(v * 1000) / 1000;
  return { x: r(x0 + 0.01), y: r(y0 + 0.01), w: r(x1 - x0 - 0.02), h: r(y1 - y0 - 0.02) };
}

// ---------------------------------------------------------------------------- clipping
/** Sutherland–Hodgman against the lng/lat box: a ring in, the part of it inside the box out. */
function clipRing(ring, box) {
  const edges = [
    [(p) => p[0] >= box.west, (a, b) => at(a, b, 0, box.west)],
    [(p) => p[0] <= box.east, (a, b) => at(a, b, 0, box.east)],
    [(p) => p[1] >= box.south, (a, b) => at(a, b, 1, box.south)],
    [(p) => p[1] <= box.north, (a, b) => at(a, b, 1, box.north)],
  ];
  let out = ring;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}
function at(a, b, axis, v) {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return axis === 0 ? [v, a[1] + t * (b[1] - a[1])] : [a[0] + t * (b[0] - a[0]), v];
}
const inBox = (p, box) => p[0] >= box.west && p[0] <= box.east && p[1] >= box.south && p[1] <= box.north;
/** A line, cut into the runs that lie inside the box (a run keeps one point outside on each end). */
function clipLine(line, box) {
  const runs = [];
  let run = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    if (inBox(p, box)) {
      if (!run.length && i > 0) run.push(line[i - 1]);
      run.push(p);
    } else if (run.length) {
      run.push(p);
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

// ---------------------------------------------------------------------------- simplification
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    let far = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > far) { far = d; idx = i; }
    }
    if (far > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyRing(pts, tol) {
  let far = 0, idx = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > far) { far = d; idx = i; }
  }
  if (idx === 0) return pts;
  return [...simplify(pts.slice(0, idx + 1), tol), ...simplify(pts.slice(idx), tol).slice(1)];
}
const area = (pts) => Math.abs(pts.reduce((s, [x, y], i) => { const [nx, ny] = pts[(i + 1) % pts.length]; return s + x * ny - nx * y; }, 0) / 2);

/**
 * Relative path data on a 1/5000-unit grid (about 6 m at Chicago): the close-up is drawn up to
 * ~15,000× the world's scale, where the world file's 1/10-unit grid would be kilometres coarse.
 */
const GRID = 5000;
function toPath(pts, closed) {
  const r = pts.map(([x, y]) => [Math.round(x * GRID), Math.round(y * GRID)]);
  const dedup = r.filter((p, i) => i === 0 || p[0] !== r[i - 1][0] || p[1] !== r[i - 1][1]);
  if (dedup.length < (closed ? 3 : 2)) return '';
  const n = (v) => { const s = +(v / GRID).toFixed(4) + ''; return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? `-${s.slice(2)}` : s; };
  let d = `M${n(dedup[0][0])} ${n(dedup[0][1])}l`;
  for (let i = 1; i < dedup.length; i++) {
    const dx = n(dedup[i][0] - dedup[i - 1][0]), dy = n(dedup[i][1] - dedup[i - 1][1]);
    d += `${i > 1 && !dx.startsWith('-') ? ' ' : ''}${dx}${dy.startsWith('-') ? '' : ' '}${dy}`;
  }
  return closed ? `${d}z` : d;
}

const rings = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const lines = (g) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

function polygons(fcs, { tol, minArea = 0, box = BOX, keep = () => true }) {
  const parts = [];
  for (const fc of fcs) for (const f of fc.features) {
    if (!keep(f.properties ?? {})) continue;
    for (const poly of rings(f.geometry)) for (const ring of poly) {
      const clipped = clipRing(ring, box);
      if (clipped.length < 3) continue;
      const pts = simplifyRing(clipped.map(project), tol);
      if (area(pts) < minArea) continue;
      const d = toPath(pts, true);
      if (d) parts.push(d);
    }
  }
  return parts.join('');
}
function polylines(fcs, { tol, box = BOX, keep = () => true }) {
  const parts = [];
  for (const fc of fcs) for (const f of fc.features) {
    if (!keep(f.properties ?? {})) continue;
    for (const line of lines(f.geometry)) for (const run of clipLine(line, box)) {
      const d = toPath(simplify(run.map(project), tol), false);
      if (d) parts.push(d);
    }
  }
  return parts.join('');
}

/**
 * Natural Earth's Lake Michigan is a 1:10m outline, a kilometre or so off along the city. Between
 * Howard Street and the Calumet this patch repaints the shore as water and the community areas then
 * repaint the city as land, so the lakefront the guest sees is the City of Chicago's own.
 */
const SHORE_PATCH = { west: -87.66, east: -87.53, south: 41.72, north: 42.019 };
/**
 * The Chicago River's main stem and both branches through downtown, as traced for the Explore map
 * (src/themes/botanical-deco/kit/CityGuide.tsx). Natural Earth has no river this small.
 */
const CHICAGO_RIVER = [
  [[-87.6133, 41.8888], [-87.62, 41.8887], [-87.6245, 41.888], [-87.63, 41.8876], [-87.635, 41.8872], [-87.6373, 41.8868], [-87.642, 41.8868]],
  [[-87.6373, 41.8868], [-87.6385, 41.89], [-87.639, 41.8935]],
  [[-87.6373, 41.8868], [-87.6382, 41.882], [-87.6385, 41.876], [-87.637, 41.869], [-87.634, 41.864], [-87.632, 41.861]],
];
const rect = (b) => toPath([[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north]].map(project), true);

// ------------------------------------------------------------------------------------ build
async function load(name) {
  const dir = process.argv[2];
  if (dir) return JSON.parse(await readFile(join(dir, `${name}.geojson`), 'utf8'));
  const res = await fetch(SOURCES[name]);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}
const src = Object.fromEntries(await Promise.all(Object.keys(SOURCES).map(async (k) => [k, await load(k)])));

const TOL = 0.002; // ~70 m: below Natural Earth 1:10m's own detail
const geometry = {
  land: polygons([src.ne_10m_land], { tol: TOL, minArea: 0.00002 }),
  urban: polygons([src.ne_10m_urban_areas], { tol: TOL, minArea: 0.00005 }),
  lakes: polygons([src.ne_10m_lakes, src.ne_10m_lakes_north_america], { tol: TOL, minArea: 0.00005 }),
  shore: rect(SHORE_PATCH),
  city: polygons([src['chicago-community-areas']], { tol: 0.0004 }),
  rivers: polylines([src.ne_10m_rivers_lake_centerlines, src.ne_10m_rivers_north_america], { tol: TOL }) + CHICAGO_RIVER.map((l) => toPath(l.map(project), false)).join(''),
  roads: polylines([src.ne_10m_roads], { tol: TOL, keep: (p) => ['Major Highway', 'Secondary Highway', 'Beltway'].includes(p.type) }),
  states: polylines([src.ne_10m_admin_1_states_provinces_lines], { tol: TOL, keep: (p) => ['United States of America', 'Canada'].includes(p.adm0_name ?? p.ADM0_NAME) }),
};
const frame = frameOf(BOX);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}">
<!-- Natural Earth 1:10m (public domain) and City of Chicago community areas (open data), Equal Earth in world.svg's drawing units. Generated by scripts/generate-atlas-region.mjs; do not edit. -->
<!-- Layers carry no paint: the page colours each one through the <use> element that draws it. -->
${Object.entries(geometry).map(([id, d]) => `<path id="${id}" vector-effect="non-scaling-stroke" d="${d}"/>`).join('\n')}
</svg>
`;
const ts = `// GENERATED by scripts/generate-atlas-region.mjs. Do not edit by hand.
// The close-up drawn inside this rectangle of the world drawing (public/assets/atlas/midwest.svg):
// longitudes ${BOX.west}° to ${BOX.east}°, latitudes ${BOX.south}° to ${BOX.north}°.
export const REGION_FRAME = ${JSON.stringify(frame)} as const;

/** The close-up's layers, each a <path id> in midwest.svg. */
export const REGION_LAYERS = ${JSON.stringify(Object.keys(geometry))} as const;
`;
await mkdir(dirname(outSvg), { recursive: true });
await writeFile(outSvg, svg);
await writeFile(outFrame, ts);
const kb = (s) => (s.length / 1024).toFixed(1);
console.log(`region: ${JSON.stringify(frame)} → public/assets/atlas/midwest.svg (${kb(svg)} KB)`);
for (const [k, v] of Object.entries(geometry)) console.log(`  ${k.padEnd(8)} ${kb(v)} KB`);
