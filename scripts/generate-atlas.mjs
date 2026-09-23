#!/usr/bin/env node
// The world drawn under Our Adventures: Natural Earth 1:50m land, lakes, country borders and
// US/Canadian state lines, projected on Equal Earth, simplified for the zoom range the map allows,
// and written as one static SVG (public/assets/atlas/world.svg, one <path id> per layer) plus the
// frame constants in src/themes/shared/atlas/frame.generated.ts.
//
//   node scripts/generate-atlas.mjs                  # fetch Natural Earth from jsDelivr
//   node scripts/generate-atlas.mjs <dir-of-geojson> # or read the four files from disk
//
// Natural Earth is public domain (naturalearthdata.com/about/terms-of-use); the ledger entry is in
// docs/ops/asset-licensing.md. Nothing is fetched at runtime: the page ships the committed output.
// The projection constants written here are the ones src/themes/shared/atlas/projection.ts reads,
// so a pin and the coastline under it can never be projected two different ways.
//
// Why a file and not inline paths: the coastline is ~160 KB of path data. Inline, it would ride in
// every HTML response AND again in the RSC payload; as a file it is fetched once and cached. The
// page draws each layer with <use href="world.svg#land">, and because the paths here carry no fill
// or stroke of their own, the theme's tokens colour them through inheritance.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outSvg = join(root, 'public', 'assets', 'atlas', 'world.svg');
const outFrame = join(root, 'src', 'themes', 'shared', 'atlas', 'frame.generated.ts');
const SOURCE = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson';
const LAYERS = {
  land: 'ne_50m_land',
  lakes: 'ne_50m_lakes',
  borders: 'ne_50m_admin_0_boundary_lines_land',
  states: 'ne_50m_admin_1_states_provinces_lines',
};

// ------------------------------------------------------------------------------ projection
// Equal Earth (Šavrič, Patterson & Jenny, 2018). Kept in step with projection.ts.
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
function equalEarth(lng, lat) {
  const l = (lng * Math.PI) / 180, p = (lat * Math.PI) / 180;
  const t = Math.asin(M * Math.sin(p)), t2 = t * t, t6 = t2 * t2 * t2;
  return [(l * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))), t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))];
}

/** The drawing is 1000 wide; the frame runs from the Arctic Ocean to below Cape Horn. Antarctica is left off. */
const WIDTH = 1000;
const NORTH = 84, SOUTH = -58;
const xMax = equalEarth(180, 0)[0];
const SCALE = WIDTH / (2 * xMax);
const TOP = equalEarth(0, NORTH)[1] * SCALE;
const HEIGHT = Math.round(TOP - equalEarth(0, SOUTH)[1] * SCALE);
const project = ([lng, lat]) => {
  const [x, y] = equalEarth(lng, lat);
  return [x * SCALE + WIDTH / 2, TOP - y * SCALE];
};

// ---------------------------------------------------------------------------- simplification
/** Douglas–Peucker in drawing units. 0.12 units is ~1.5 screen pixels at the deepest zoom. */
const TOLERANCE = 0.12;
function simplify(pts, tol = TOLERANCE) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    let far = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > far) { far = d; idx = i; }
    }
    if (far > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A closed ring starts and ends on one point, which gives Douglas–Peucker no baseline: split it at its far side. */
function simplifyRing(pts) {
  let far = 0, idx = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > far) { far = d; idx = i; }
  }
  if (idx === 0) return pts;
  return [...simplify(pts.slice(0, idx + 1)), ...simplify(pts.slice(idx)).slice(1)];
}

const area = (pts) => Math.abs(pts.reduce((s, [x, y], i) => { const [nx, ny] = pts[(i + 1) % pts.length]; return s + x * ny - nx * y; }, 0) / 2);

/** Relative path data from rounded absolute points, so rounding never drifts along a coastline. */
function toPath(pts, closed) {
  const r = pts.map(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]);
  const dedup = r.filter((p, i) => i === 0 || p[0] !== r[i - 1][0] || p[1] !== r[i - 1][1]);
  if (dedup.length < (closed ? 3 : 2)) return '';
  const n = (v) => { const s = (v / 10).toString(); return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? `-${s.slice(2)}` : s; };
  let d = `M${n(dedup[0][0])} ${n(dedup[0][1])}l`;
  for (let i = 1; i < dedup.length; i++) {
    const dx = n(dedup[i][0] - dedup[i - 1][0]), dy = n(dedup[i][1] - dedup[i - 1][1]);
    d += `${i > 1 && !dx.startsWith('-') ? ' ' : ''}${dx}${dy.startsWith('-') ? '' : ' '}${dy}`;
  }
  return closed ? `${d}z` : d;
}

const rings = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []);
const lines = (geom) => (geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : []);

/** A ring that wraps the antimeridian (Chukotka, Fiji) would streak across the map; split it at the jump. */
function unwrap(coords) {
  const parts = [[]];
  for (let i = 0; i < coords.length; i++) {
    if (i && Math.abs(coords[i][0] - coords[i - 1][0]) > 180) parts.push([]);
    parts[parts.length - 1].push(coords[i]);
  }
  return parts;
}

function polygons(fc, { minArea, south = SOUTH - 2 }) {
  const parts = [];
  for (const f of fc.features) {
    for (const poly of rings(f.geometry)) {
      for (const ring of poly) {
        if (ring.every(([, lat]) => lat < south)) continue;
        const clipped = ring.map(([lng, lat]) => [lng, Math.max(lat, SOUTH - 2)]);
        const segs = unwrap(clipped);
        for (const seg of segs) {
          const pts = segs.length === 1 ? simplifyRing(seg.map(project)) : simplify(seg.map(project));
          if (area(pts) < minArea) continue;
          const d = toPath(pts, segs.length === 1);
          if (d) parts.push(d);
        }
      }
    }
  }
  return parts.join('');
}

function polylines(fc, keep = () => true) {
  const parts = [];
  for (const f of fc.features) {
    if (!keep(f.properties ?? {})) continue;
    for (const line of lines(f.geometry)) for (const seg of unwrap(line)) {
      const d = toPath(simplify(seg.map(project), TOLERANCE * 1.5), false);
      if (d) parts.push(d);
    }
  }
  return parts.join('');
}

/** Gold hairlines every 30° of longitude and at the tropics, the equator and the polar circles. */
function graticule() {
  const parts = [];
  for (let lng = -180; lng <= 180; lng += 30) {
    const pts = [];
    for (let lat = SOUTH; lat <= NORTH; lat += 2) pts.push(project([lng, lat]));
    parts.push(toPath(pts, false));
  }
  return parts.join('');
}
function parallel(lat) {
  const pts = [];
  for (let lng = -180; lng <= 180; lng += 3) pts.push(project([lng, lat]));
  return toPath(pts, false);
}
function outline() {
  const pts = [];
  for (let lat = SOUTH; lat <= NORTH; lat += 1) pts.push(project([-180, lat]));
  for (let lng = -180; lng <= 180; lng += 3) pts.push(project([lng, NORTH]));
  for (let lat = NORTH; lat >= SOUTH; lat -= 1) pts.push(project([180, lat]));
  for (let lng = 180; lng >= -180; lng -= 3) pts.push(project([lng, SOUTH]));
  return toPath(pts, true);
}

// ------------------------------------------------------------------------------------ build
async function load(name) {
  const dir = process.argv[2];
  if (dir) return JSON.parse(await readFile(join(dir, `${name}.geojson`), 'utf8'));
  const res = await fetch(`${SOURCE}/${name}.geojson`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

const [land, lakes, borders, states] = await Promise.all(Object.values(LAYERS).map(load));
const geometry = {
  land: polygons(land, { minArea: 0.25 }),
  lakes: polygons(lakes, { minArea: 3 }),
  borders: polylines(borders),
  states: polylines(states, (p) => ['United States of America', 'Canada'].includes(p.adm0_name ?? p.ADM0_NAME)),
  graticule: graticule(),
  equator: parallel(0),
  tropics: [parallel(23.44), parallel(-23.44), parallel(66.56)].join(''),
  outline: outline(),
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">
<!-- Natural Earth 1:50m (public domain), Equal Earth projection. Generated by scripts/generate-atlas.mjs; do not edit. -->
<!-- Layers carry no paint: the page colours each one through the <use> element that draws it. -->
${Object.entries(geometry).map(([id, d]) => `<path id="${id}" vector-effect="non-scaling-stroke" d="${d}"/>`).join('\n')}
</svg>
`;
const frame = `// GENERATED by scripts/generate-atlas.mjs. Do not edit by hand.
// Equal Earth, ${WIDTH} × ${HEIGHT} drawing units, latitudes ${SOUTH}° to ${NORTH}°. The drawing is public/assets/atlas/world.svg.
export const ATLAS_FRAME = ${JSON.stringify({ width: WIDTH, height: HEIGHT, scale: +SCALE.toFixed(6), top: +TOP.toFixed(6), north: NORTH, south: SOUTH })} as const;

/** The drawing's layers, each a <path id> in world.svg. */
export const ATLAS_LAYERS = ${JSON.stringify(Object.keys(geometry))} as const;
`;
await mkdir(dirname(outSvg), { recursive: true });
await writeFile(outSvg, svg);
await writeFile(outFrame, frame);
const kb = (s) => (s.length / 1024).toFixed(1);
console.log(`atlas: ${WIDTH}×${HEIGHT} → public/assets/atlas/world.svg (${kb(svg)} KB), src/themes/shared/atlas/frame.generated.ts`);
for (const [k, v] of Object.entries(geometry)) console.log(`  ${k.padEnd(10)} ${kb(v)} KB`);
