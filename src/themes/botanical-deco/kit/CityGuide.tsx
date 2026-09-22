'use client';

import { useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react';

/**
 * The Chicago band's guide: three places Sara and Tyler love, as a list and as a map, each
 * pointing at the other. Hovering or focusing an entry lights its pin; choosing a pin lights and
 * moves focus to its entry. The list is complete on its own — the map adds nothing a list reader
 * lacks — so a keyboard, a screen reader or a phone never depends on the drawing.
 *
 * The map is drawn from real coordinates on one equirectangular projection, so positions and the
 * shoreline are to scale; streets are omitted and it says so. North Pond lies well north of the
 * frame and is shown as an arrow at the edge, not moved closer to fit.
 *
 * The list itself is rendered on the server and handed in as `children` — one `<li data-place>`
 * per place, photographs included — so no image markup crosses into this client bundle. This
 * component only listens to the list (hover and focus bubble up to it) and marks the chosen entry.
 */

/** What the map needs to know about a place: where it is and what to call it. */
export interface CityPin {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Where the map label sits; "below" for a place that lies on the river line it would cross. */
  label?: 'above' | 'below';
}

const FRAME = { north: 41.8935, south: 41.861, west: -87.642, east: -87.598 };
const W = 330;
const KX = Math.cos((41.877 * Math.PI) / 180);
const H = Math.round((W * (FRAME.north - FRAME.south)) / ((FRAME.east - FRAME.west) * KX));
const px = (lat: number, lon: number): [number, number] => [+(((lon - FRAME.west) / (FRAME.east - FRAME.west)) * W).toFixed(1), +(((FRAME.north - lat) / (FRAME.north - FRAME.south)) * H).toFixed(1)];
const inFrame = (lat: number, lon: number) => lat <= FRAME.north && lat >= FRAME.south && lon >= FRAME.west && lon <= FRAME.east;

/** Shoreline from Ohio Street Beach to Northerly Island, around Navy Pier and the Museum Campus. */
const SHORE: [number, number][] = [
  [41.8935, -87.6152],
  [41.8925, -87.6136],
  [41.8925, -87.5985],
  [41.8909, -87.5985],
  [41.8909, -87.613],
  [41.8889, -87.6133],
  [41.8868, -87.6137],
  [41.8832, -87.615],
  [41.88, -87.6169],
  [41.875, -87.6178],
  [41.8702, -87.6171],
  [41.868, -87.615],
  [41.8671, -87.6082],
  [41.8666, -87.6058],
  [41.8654, -87.6059],
  [41.864, -87.6074],
  [41.861, -87.6086],
];
const RIVER: [number, number][][] = [
  [
    [41.8888, -87.6133],
    [41.8887, -87.62],
    [41.888, -87.6245],
    [41.8876, -87.63],
    [41.8872, -87.635],
    [41.8868, -87.6373],
    [41.8868, -87.642],
  ],
  [
    [41.8868, -87.6373],
    [41.89, -87.6385],
    [41.8935, -87.639],
  ],
  [
    [41.8868, -87.6373],
    [41.882, -87.6382],
    [41.876, -87.6385],
    [41.869, -87.637],
    [41.864, -87.634],
    [41.861, -87.632],
  ],
];

const path = (pts: [number, number][]) => pts.map(([la, lo], i) => `${i ? 'L' : 'M'}${px(la, lo).join(' ')}`).join('');
const WATER = `${path(SHORE)}L${W} ${H}L${W} 0Z`;
/** Under the pier the shoreline draws out into the lake, so the strip is named rather than left to read as a flaw. */
const PIER = px(41.8903, -87.6062);

export function CityGuide({ places, venue, guide, children }: { places: CityPin[]; venue: { name: string; lat: number; lon: number }; guide: ReactNode; children: ReactNode }) {
  // `chosen` is what a guest picked on the map: it persists and drives aria-pressed. `hovered` is
  // where the pointer or focus is in the list, and only lights things while it is there.
  const [chosen, setChosen] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const active = hovered ?? chosen;
  const root = useRef<HTMLDivElement>(null);
  const uid = useId();
  const [vx, vy] = px(venue.lat, venue.lon);
  const entry = (id: string) => root.current?.querySelector<HTMLElement>(`[data-place="${id}"]`) ?? null;
  const pick = (e: SyntheticEvent) => setHovered((e.target as HTMLElement).closest<HTMLElement>('[data-place]')?.dataset.place ?? null);
  const leave = (e: FocusEvent | MouseEvent) => {
    if (e.type === 'blur' && e.currentTarget.contains((e as FocusEvent).relatedTarget as Node | null)) return;
    setHovered(null);
  };
  const choose = (id: string) => {
    setChosen(id);
    setHovered(null);
    const el = entry(id);
    el?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
  };
  // The entries are server-rendered, so the highlight is an attribute set on them, not a prop.
  useEffect(() => {
    for (const el of root.current?.querySelectorAll<HTMLElement>('[data-place]') ?? []) {
      if (el.dataset.place === active) el.setAttribute('data-active', 'true');
      else el.removeAttribute('data-active');
    }
  }, [active]);
  return (
    <div className="bd-cityguide" ref={root} data-active={active ?? undefined}>
      <ul className="bd-cityguide__list" aria-label="A few of our favorite places" onMouseOver={pick} onMouseLeave={leave} onFocus={pick} onBlur={leave}>
        {children}
      </ul>
      <figure className="bd-citymap">
        <div className="bd-citymap__canvas">
          <svg className="bd-citymap__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${uid}-map`}>
            <title id={`${uid}-map`}>Map of the Loop and the lakefront with the hotel and our favorite places marked. The same places are listed beside it.</title>
            <rect width={W} height={H} className="bd-citymap__land" />
            <path d={WATER} className="bd-citymap__water" />
            {RIVER.map((r, i) => (
              <path key={i} d={path(r)} className="bd-citymap__river" />
            ))}
            <text x={W - 12} y={H * 0.62} className="bd-citymap__lake" textAnchor="end" aria-hidden="true">
              Lake Michigan
            </text>
            <text x={PIER[0]} y={PIER[1] + 10} className="bd-citymap__pier" textAnchor="middle" aria-hidden="true">
              Navy Pier
            </text>
            <g className="bd-citymap__venue" transform={`translate(${vx} ${vy})`}>
              <rect x="-6" y="-6" width="12" height="12" transform="rotate(45)" />
              <text x="-12" y="4" textAnchor="end" aria-hidden="true">
                {venue.name}
              </text>
            </g>
            {places.map((p) => {
              if (!inFrame(p.lat, p.lon)) {
                const [x] = px(FRAME.north, p.lon);
                return (
                  <g key={p.id} className="bd-citymap__offmap" data-active={active === p.id ? 'true' : undefined}>
                    <path d={`M${x} 26L${x} 8M${x - 6} 14L${x} 8L${x + 6} 14`} />
                    <text x={x + 10} y="22" aria-hidden="true">
                      {p.name}, further north
                    </text>
                  </g>
                );
              }
              const [x, y] = px(p.lat, p.lon);
              return (
                <g key={p.id} className="bd-citymap__pin" data-active={active === p.id ? 'true' : undefined} transform={`translate(${x} ${y})`}>
                  <circle r="11" className="bd-citymap__halo" />
                  <circle r="6" />
                  <text x={x > W * 0.6 ? -12 : 12} y={p.label === 'below' ? 22 : -8} textAnchor={x > W * 0.6 ? 'end' : 'start'} aria-hidden="true">
                    {p.name}
                  </text>
                </g>
              );
            })}
          </svg>
          {/* The pins are drawn in the SVG; these 44px targets sit on them and choose them. */}
          <div className="bd-citymap__controls">
            {places.map((p) => {
              const [x, y] = inFrame(p.lat, p.lon) ? px(p.lat, p.lon) : [px(FRAME.north, p.lon)[0], 16];
              return (
                <button
                  key={p.id}
                  type="button"
                  className="bd-citymap__choose"
                  data-pin={p.id}
                  style={{
                    left: `${(x / W) * 100}%`,
                    top: `${(y / H) * 100}%`,
                  }}
                  aria-pressed={chosen === p.id}
                  onClick={() => choose(p.id)}
                >
                  <span className="sr-only">Show {p.name} in the list</span>
                </button>
              );
            })}
          </div>
        </div>
        <figcaption className="bd-citymap__note">Places to scale; streets left out. For directions, use each place’s link.</figcaption>
        {guide}
      </figure>
    </div>
  );
}
