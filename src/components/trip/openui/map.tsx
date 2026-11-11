'use client';

import { defineComponent, reactive, useIsStreaming, useStateField } from '@openuidev/react-lang';
import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod/v4';
import { ATLAS_FILES } from '@/themes/shared/atlas/files';
import { MIDWEST, SKY, WORLD, layerOn, regionInView, type Layer } from '@/themes/shared/atlas/layers';
import { ATLAS_H, ATLAS_W, MAX_ZOOM, REGION, fitView, project, unitsPerKm, viewBox } from '@/themes/shared/atlas/projection';
import { useTripPlanner } from './context';

/**
 * The answer's places on the site's own drawn atlas (the one under Our Adventures): the same world
 * and Midwest files, the same projection and the same layers, so the lakefront, the river and the
 * roads sit under the pins. No tiles: the page fetches only from itself. The view is fitted once to
 * the answer's places and the hotel and does not pan or zoom; a place out of town simply fits a
 * wider view. Pins are numbered in plan order and are buttons bound to a `$variable`; pins that
 * would cover one another are fanned out around their true spot, with a short line back to it.
 * The numbered list under the map says the same thing in words.
 */

export const MapMarker = defineComponent({
  name: 'MapMarker',
  props: z.object({ label: z.string(), lat: z.number().nullish(), lng: z.number().nullish(), id: z.string().optional() }),
  description: 'A place on a Map, numbered in marker order. Without lat and lng it is listed under the map but has no pin.',
  component: () => null,
});

type Pin = { key: string; label: string; lat: number; lng: number; n: number };
type Stop = { key: string; label: string; n: number; pinned: boolean };

/** Every marker as a numbered stop, in order; the ones with a real position are also pins. */
function stopsOf(markers: unknown, streaming: boolean): { stops: Stop[]; pins: Pin[] } {
  const stops: Stop[] = [];
  const pins: Pin[] = [];
  (Array.isArray(markers) ? markers.flat() : []).forEach((item) => {
    const el = item as { type?: string; partial?: boolean; props?: Record<string, unknown> } | null;
    if (el?.type !== 'element' || !el.props || (streaming && el.partial)) return;
    const { label, lat, lng } = el.props;
    if (typeof label !== 'string' || !label.trim()) return;
    const n = stops.length + 1;
    const key = `${label}-${n}`;
    const pinned = typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    stops.push({ key, label, n, pinned });
    if (pinned) pins.push({ key, label, lat: lat as number, lng: lng as number, n });
  });
  return { stops, pins };
}

const PIN = 44; // the touch target, in CSS px
const H_PHONE = 300;
const H_WIDE = 360;
/** However close the places, the view shows at least this much of the city across, so the lakefront and a street or two read. */
const MIN_SPAN_KM = 5;
/** Room around the places, as a fraction of the frame, so no pin sits on the edge. */
const PAD = 0.16;

/** The map's own class for each atlas layer (the atlas's colours, in this library's stylesheet). */
const cls = (l: Layer) => l.className.replace('bd-atlas__', 'trip-map__');

/**
 * Screen positions for the pins: each at its true spot unless that would cover a pin (or the hotel)
 * already placed, in which case it moves to the nearest free spot on rings around it.
 */
export function spreadPins(points: { x: number; y: number }[], taken: { x: number; y: number }[], W: number, H: number, size = PIN): { x: number; y: number }[] {
  const clear = (x: number, y: number, against: { x: number; y: number }[]) => against.every((t) => Math.abs(t.x - x) >= size || Math.abs(t.y - y) >= size);
  const inside = (v: number, max: number) => Math.min(Math.max(v, size / 2), max - size / 2);
  const placed: { x: number; y: number }[] = [];
  for (const p of points) {
    const home = { x: inside(p.x, W), y: inside(p.y, H) };
    let spot = home;
    const others = [...taken, ...placed];
    if (!clear(home.x, home.y, others)) {
      let found: { x: number; y: number } | null = null;
      for (let ring = 1; ring <= 4 && !found; ring++) {
        const steps = 6 * ring;
        for (let i = 0; i < steps && !found; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
          const x = inside(home.x + Math.cos(a) * size * 1.05 * ring, W);
          const y = inside(home.y + Math.sin(a) * size * 1.05 * ring, H);
          if (clear(x, y, others)) found = { x, y };
        }
      }
      spot = found ?? home;
    }
    placed.push(spot);
  }
  return placed;
}

/**
 * The site's own drawn atlas for a view: the sky, the world outside the close-up's rectangle and the
 * Midwest close-up inside it, each layer only at the zooms it reads at. Decorative: whatever it
 * shows is said in words beside it.
 */
export function AtlasGround({ view, vb, className }: { view: { k: number }; vb: { x: number; y: number; w: number; h: number }; className: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const R = REGION;
  const layer = (l: Layer, i: number) => (layerOn(l, view.k, vb) ? <use key={`${l.file}-${l.id}-${i}`} href={`${ATLAS_FILES[l.file]}#${l.id}`} className={cls(l)} /> : null);
  return (
    <svg className={className} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        {/* As on the atlas: the world everywhere but the close-up's rectangle, the close-up only inside it. */}
        <clipPath id={`${uid}-world`}>
          <path clipRule="evenodd" d={`M0 0H${ATLAS_W}V${ATLAS_H}H0Z M${R.x} ${R.y}h${R.w}v${R.h}h${-R.w}Z`} />
        </clipPath>
        <clipPath id={`${uid}-region`}>
          <rect x={R.x} y={R.y} width={R.w} height={R.h} />
        </clipPath>
      </defs>
      {SKY.map(layer)}
      <g clipPath={`url(#${uid}-world)`}>{WORLD.map(layer)}</g>
      {regionInView(vb) ? <g clipPath={`url(#${uid}-region)`}>{MIDWEST.map(layer)}</g> : null}
    </svg>
  );
}

export const MapView = defineComponent({
  name: 'Map',
  props: z.object({ markers: z.array(MapMarker.ref), route: z.boolean().optional(), selected: reactive(z.string().optional()) }),
  description: 'A drawn map fitted to its markers, with the hotel marked. route draws the line between them in order; selected holds the chosen pin label.',
  component: function MapComponent({ props, statementId }) {
    const ctx = useTripPlanner();
    const streaming = useIsStreaming();
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const selection = useStateField(statementId ?? `map-${uid}`, props.selected);
    const selected = typeof selection.value === 'string' ? selection.value : '';
    const { stops, pins } = stopsOf(props.markers, streaming);
    const frame = useRef<HTMLDivElement>(null);
    const [W, setW] = useState(360);
    useEffect(() => {
      const el = frame.current;
      if (!el || typeof ResizeObserver !== 'function') return;
      const ro = new ResizeObserver(() => {
        const w = Math.round(el.clientWidth);
        if (w > 0) setW((old) => (Math.abs(old - w) > 2 ? w : old));
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    if (!pins.length) return null;

    const wide = W >= 520;
    const H = wide ? H_WIDE : H_PHONE;
    const aspect = W / H;
    const hotel = ctx?.hotel ?? null;
    const at = pins.map((p) => project(p.lat, p.lng));
    const hotelAt = hotel ? project(hotel.lat, hotel.lng) : null;
    const all = hotelAt ? [...at, hotelAt] : at;
    const midLat = [...pins.map((p) => p.lat), ...(hotel ? [hotel.lat] : [])].reduce((s, v, _, a) => s + v / a.length, 0);
    const minSpan = unitsPerKm(midLat) * MIN_SPAN_KM;
    const view = fitView(all, aspect, { pad: PAD, maxK: Math.min(MAX_ZOOM, ATLAS_W / Math.max(minSpan, 1e-9)) });
    const vb = viewBox(view, aspect);
    const toScreen = (q: { x: number; y: number }) => ({ x: ((q.x - vb.x) / vb.w) * W, y: ((q.y - vb.y) / vb.h) * H });

    const truth = at.map(toScreen);
    const hotelXY = hotelAt ? toScreen(hotelAt) : null;
    const placed = spreadPins(truth, hotelXY ? [hotelXY] : [], W, H);
    const route = props.route && placed.length > 1 ? placed.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') : null;
    const hotelLeft = hotelXY ? hotelXY.x > W * 0.6 : false;


    return (
      <figure className="trip-map">
        <div className="trip-map__frame" ref={frame} data-size={wide ? 'wide' : 'phone'} data-zoom={view.k >= 1000 ? 'city' : 'region'}>
          <AtlasGround view={view} vb={vb} className="trip-map__ground" />
          <svg viewBox={`0 0 ${W} ${H}`} className="trip-map__drawing" role="img" aria-label={`Map with ${pins.length} ${pins.length === 1 ? 'place' : 'places'}${hotel ? ' and the hotel' : ''}`}>
            {route ? <path d={route} className="trip-map__route" /> : null}
            {placed.map((q, i) => {
              const t = truth[i]!;
              const moved = Math.hypot(q.x - t.x, q.y - t.y) > 2;
              return moved ? (
                <g key={pins[i]!.key}>
                  <line x1={t.x} y1={t.y} x2={q.x} y2={q.y} className="trip-map__leader" />
                  <circle cx={t.x} cy={t.y} r={3} className="trip-map__spot" />
                </g>
              ) : null;
            })}
            {hotelXY ? (
              <g transform={`translate(${hotelXY.x.toFixed(1)} ${hotelXY.y.toFixed(1)})`}>
                <rect x={-8} y={-8} width={16} height={16} transform="rotate(45)" className="trip-map__hotel" />
                <rect x={-3} y={-3} width={6} height={6} transform="rotate(45)" className="trip-map__hotel-inner" />
                <text x={hotelLeft ? -16 : 16} y={5} textAnchor={hotelLeft ? 'end' : 'start'} className="trip-map__hotel-label">
                  Our hotel
                </text>
              </g>
            ) : null}
          </svg>
          {placed.map(({ x, y }, i) => {
            const p = pins[i]!;
            const on = selected === p.label;
            return (
              <button
                key={p.key}
                type="button"
                className={`trip-map__pin${on ? ' is-selected' : ''}`}
                style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
                aria-pressed={on}
                aria-label={`${p.n}. ${p.label}`}
                onClick={() => selection.setValue(on ? '' : p.label)}
              >
                <span aria-hidden="true">{p.n}</span>
              </button>
            );
          })}
        </div>
        <figcaption className="trip-map__caption">
          <ol className="trip-map__legend">
            {stops.map((p) => (
              <li key={p.key} value={p.n} className={selected === p.label ? 'is-selected' : undefined}>
                {p.label}
                {p.pinned ? null : <span className="trip-map__unpinned"> (not on the map)</span>}
              </li>
            ))}
          </ol>
          <span className="trip-caption">Pins are at their real places; a thin line leads back to one moved aside to be read.</span>
        </figcaption>
      </figure>
    );
  },
});
