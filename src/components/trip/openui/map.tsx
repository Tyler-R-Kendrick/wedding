'use client';

import { defineComponent, reactive, useIsStreaming, useStateField } from '@openuidev/react-lang';
import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod/v4';
import { useTripPlanner } from './context';

/**
 * A drawn map with no tiles (the page may only fetch from itself): numbered pins at their true
 * positions relative to one another and to the hotel, which is always marked. Pins that would sit
 * on top of each other are moved apart so each can be read and tapped. Every pin is a button bound
 * to a `$variable`, and the numbered list under the map says the same thing in words.
 */

export const MapMarker = defineComponent({
  name: 'MapMarker',
  props: z.object({ label: z.string(), lat: z.number(), lng: z.number(), id: z.string().optional() }),
  description: 'A place on a Map; its pin shows its number in marker order.',
  component: () => null,
});

type Pin = { key: string; label: string; lat: number; lng: number; n: number };

function pinsOf(markers: unknown, streaming: boolean): Pin[] {
  const out: Pin[] = [];
  (Array.isArray(markers) ? markers.flat() : []).forEach((item) => {
    const el = item as { type?: string; partial?: boolean; props?: Record<string, unknown> } | null;
    if (el?.type !== 'element' || !el.props || (streaming && el.partial)) return;
    const { label, lat, lng } = el.props;
    if (typeof label !== 'string' || !label.trim() || typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    out.push({ key: `${label}-${out.length}`, label, lat, lng, n: out.length + 1 });
  });
  return out;
}

const PIN = 44; // the touch target, in CSS px
const H_PHONE = 300;
const H_WIDE = 360;

export const MapView = defineComponent({
  name: 'Map',
  props: z.object({ markers: z.array(MapMarker.ref), route: z.boolean().optional(), selected: reactive(z.string().optional()) }),
  description: 'A drawn map fitted to its markers, with the hotel marked. route draws the line between them in order; selected holds the chosen pin label.',
  component: function MapComponent({ props, statementId }) {
    const ctx = useTripPlanner();
    const streaming = useIsStreaming();
    const fallbackId = useId();
    const selection = useStateField(statementId ?? `map-${fallbackId}`, props.selected);
    const selected = typeof selection.value === 'string' ? selection.value : '';
    const pins = pinsOf(props.markers, streaming);
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

    const H = W < 520 ? H_PHONE : H_WIDE;
    const hotel = ctx?.hotel ?? null;
    const pts = [...pins.map((p) => [p.lat, p.lng] as const), ...(hotel ? [[hotel.lat, hotel.lng] as const] : [])];
    const midLat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const k = Math.cos((midLat * Math.PI) / 180);
    let minLat = Math.min(...pts.map((p) => p[0]));
    let maxLat = Math.max(...pts.map((p) => p[0]));
    let minLng = Math.min(...pts.map((p) => p[1]));
    let maxLng = Math.max(...pts.map((p) => p[1]));
    const padLat = Math.max((maxLat - minLat) * 0.2, 0.002);
    const padLng = Math.max((maxLng - minLng) * 0.2, 0.003);
    minLat -= padLat;
    maxLat += padLat;
    minLng -= padLng;
    maxLng += padLng;
    const scale = Math.min(W / ((maxLng - minLng) * k), H / (maxLat - minLat));
    const cx = (minLng + maxLng) / 2;
    const cy = (minLat + maxLat) / 2;
    const xy = (lat: number, lng: number): [number, number] => [W / 2 + (lng - cx) * k * scale, H / 2 - (lat - cy) * scale];
    const inside = (v: number, size: number) => Math.min(Math.max(v, PIN / 2), size - PIN / 2);

    // Pins that would overlap (several places share the hotel's address) step down until each is clear.
    const taken: [number, number][] = hotel ? [xy(hotel.lat, hotel.lng)] : [];
    const placed = pins.map((p) => {
      let [x, y] = xy(p.lat, p.lng);
      x = inside(x, W);
      y = inside(y, H);
      let guard = 0;
      while (taken.some(([tx, ty]) => Math.abs(tx - x) < PIN && Math.abs(ty - y) < PIN) && guard++ < 12) {
        y += PIN;
        if (y > H - PIN / 2) {
          y = PIN / 2;
          x = inside(x + PIN, W);
        }
      }
      taken.push([x, y]);
      return { p, x, y };
    });
    const route = props.route && placed.length > 1 ? placed.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') : null;
    const hotelXY = hotel ? xy(hotel.lat, hotel.lng) : null;
    const gridLines = [0.25, 0.5, 0.75];

    return (
      <figure className="trip-map">
        <div className="trip-map__frame" ref={frame} data-size={W < 520 ? 'phone' : 'wide'}>
          <svg viewBox={`0 0 ${W} ${H}`} className="trip-map__drawing" role="img" aria-label={`Map with ${pins.length} ${pins.length === 1 ? 'place' : 'places'}${hotel ? ' and the hotel' : ''}`}>
            <rect width={W} height={H} className="trip-map__ground" />
            {gridLines.map((f) => (
              <g key={f}>
                <line x1={0} x2={W} y1={H * f} y2={H * f} className="trip-map__grid" />
                <line y1={0} y2={H} x1={W * f} x2={W * f} className="trip-map__grid" />
              </g>
            ))}
            {route ? <path d={route} className="trip-map__route" /> : null}
            {hotelXY ? (
              <g transform={`translate(${hotelXY[0].toFixed(1)} ${hotelXY[1].toFixed(1)})`}>
                <rect x={-7} y={-7} width={14} height={14} transform="rotate(45)" className="trip-map__hotel" />
                <text x={hotelXY[0] > W / 2 ? -14 : 14} y={5} textAnchor={hotelXY[0] > W / 2 ? 'end' : 'start'} className="trip-map__hotel-label">
                  Our hotel
                </text>
              </g>
            ) : null}
          </svg>
          {placed.map(({ p, x, y }) => {
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
            {pins.map((p) => (
              <li key={p.key} className={selected === p.label ? 'is-selected' : undefined}>
                {p.label}
              </li>
            ))}
          </ol>
          <span className="trip-caption">A simple drawing: pins are at their real positions, streets are not drawn.</span>
        </figcaption>
      </figure>
    );
  },
});
