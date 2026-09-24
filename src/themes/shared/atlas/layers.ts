import { REGION, type ViewBox } from './projection';

/*
 * Which base-map layers the atlas draws at a given depth. Pure, so the rules are unit-tested; the
 * component (AdventureAtlas) applies them on every frame of a gesture.
 *
 * Every rule here is a measured cost, not a style choice. At the default view (Chicago, ~1,900× the
 * world) the dashed tropics took ~230 ms a frame and the equator ~80 ms, because the browser dashes
 * and strokes the whole world-long line in screen pixels even when it is thousands of kilometres off
 * screen; the dashed state lines took ~110 ms at street scale. Not drawing them where they cannot be
 * seen is what makes the map move at 60 frames a second.
 */

/** Graticule, tropics and equator: world-scale ornament, drawn only while the frame is continental or wider. */
export const DECOR_MAX_ZOOM = 12;
/** Dashed state lines: from a region's scale to a city's (past ~20 km across their dashes cost whole frames). */
export const STATES_MIN_ZOOM = 2.5;
export const STATES_MAX_ZOOM = 4000;
/** Interstates and rivers once the frame is a region, not a continent; community areas once it is a city. */
export const ROADS_ZOOM = 20;
export const DISTRICTS_ZOOM = 400;

/** A base-map layer: its file and path id, its class, and the depths it is drawn at. */
export interface Layer {
  file: 'world' | 'midwest';
  id: string;
  className: string;
  kMin?: number;
  kMax?: number;
  /**
   * Fine Midwest detail (roads, rivers, districts): drawn only while the frame lies inside the
   * close-up. The world outside it has no roads, so detail that reached the frame's edge would stop
   * in a straight seam across the map (it did, just west of Starved Rock).
   */
  detail?: boolean;
}

export const SKY: Layer[] = [
  { file: 'world', id: 'outline', className: 'bd-atlas__sea' },
  { file: 'world', id: 'graticule', className: 'bd-atlas__grid', kMax: DECOR_MAX_ZOOM },
  { file: 'world', id: 'tropics', className: 'bd-atlas__tropics', kMax: DECOR_MAX_ZOOM },
  { file: 'world', id: 'equator', className: 'bd-atlas__equator', kMax: DECOR_MAX_ZOOM },
];
/** Drawn everywhere but the close-up's rectangle. */
export const WORLD: Layer[] = [
  { file: 'world', id: 'land', className: 'bd-atlas__land' },
  { file: 'world', id: 'lakes', className: 'bd-atlas__lakes' },
  { file: 'world', id: 'borders', className: 'bd-atlas__borders' },
  { file: 'world', id: 'states', className: 'bd-atlas__states', kMin: STATES_MIN_ZOOM, kMax: STATES_MAX_ZOOM },
];
/** Drawn only inside the close-up's rectangle. */
export const MIDWEST: Layer[] = [
  { file: 'midwest', id: 'land', className: 'bd-atlas__region-land' },
  { file: 'midwest', id: 'urban', className: 'bd-atlas__urban' },
  { file: 'midwest', id: 'lakes', className: 'bd-atlas__lakes' },
  { file: 'midwest', id: 'shore', className: 'bd-atlas__shore' },
  { file: 'midwest', id: 'city', className: 'bd-atlas__city' },
  { file: 'midwest', id: 'city', className: 'bd-atlas__districts', kMin: DISTRICTS_ZOOM, detail: true },
  { file: 'midwest', id: 'rivers', className: 'bd-atlas__rivers', kMin: ROADS_ZOOM, detail: true },
  { file: 'midwest', id: 'roads', className: 'bd-atlas__roads', kMin: ROADS_ZOOM, detail: true },
  { file: 'midwest', id: 'states', className: 'bd-atlas__states', kMin: STATES_MIN_ZOOM, kMax: STATES_MAX_ZOOM },
];

/** Some of the close-up is in the frame. */
export const regionInView = (vb: ViewBox) => REGION.x < vb.x + vb.w && vb.x < REGION.x + REGION.w && REGION.y < vb.y + vb.h && vb.y < REGION.y + REGION.h;

/** The frame lies within the close-up (to 1% of its width), so the close-up's fine layers fill it with no edge showing. */
export const insideRegion = (vb: ViewBox) => {
  const e = vb.w * 0.01;
  return vb.x >= REGION.x - e && vb.x + vb.w <= REGION.x + REGION.w + e && vb.y >= REGION.y - e && vb.y + vb.h <= REGION.y + REGION.h + e;
};

/** Whether `layer` is drawn at zoom `k` with frame `vb`. */
export const layerOn = (layer: Pick<Layer, 'kMin' | 'kMax' | 'detail'>, k: number, vb: ViewBox) =>
  k >= (layer.kMin ?? 0) && k <= (layer.kMax ?? Infinity) && (!layer.detail || insideRegion(vb));
