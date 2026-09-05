import type { FloorPlanAnchor } from '@/db/schema/seating';
import { seedId } from '@/db/seed/ids';

/**
 * Placeholder floor plans, one per CAA space named in docs/design/brief.md §2.
 * Outlines are schematic rectangles; anchors are a neutral grid. Real plans come from the
 * planner (Bustle & Lace) — TODO(Tyler & Sara). `placeholder: true` is rendered as such.
 */
export interface PlaceholderPlan {
  id: string;
  venueSpaceRef: string;
  name: string;
  viewBox: string;
  outline: string;
  anchors: FloorPlanAnchor[];
}

function grid(cols: number, rows: number, x0: number, y0: number, dx: number, dy: number): FloorPlanAnchor[] {
  const out: FloorPlanAnchor[] = [];
  let n = 1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ id: `t${n}`, x: x0 + c * dx, y: y0 + r * dy, label: `Table ${n++}` });
  return out;
}

export const PLACEHOLDER_PLANS: PlaceholderPlan[] = [
  { id: seedId('PLANWHITECITY'), venueSpaceRef: 'white-city-ballroom', name: 'White City Ballroom', viewBox: '0 0 800 520', outline: 'M20 20 H780 V500 H20 Z', anchors: grid(5, 4, 100, 90, 150, 110) },
  { id: seedId('PLANMADISON'), venueSpaceRef: 'madison-ballroom', name: 'Madison Ballroom', viewBox: '0 0 800 460', outline: 'M20 20 H780 V440 H20 Z', anchors: grid(4, 3, 130, 100, 180, 130) },
  { id: seedId('PLANSTAGG'), venueSpaceRef: 'stagg-court', name: 'Stagg Court', viewBox: '0 0 900 520', outline: 'M20 20 H880 V500 H20 Z', anchors: grid(6, 4, 90, 90, 145, 110) },
  { id: seedId('PLANTANK'), venueSpaceRef: 'the-tank', name: 'The Tank', viewBox: '0 0 700 420', outline: 'M20 20 H680 V400 H20 Z', anchors: grid(4, 3, 110, 90, 160, 120) },
];

export const VENUE_SPACES = PLACEHOLDER_PLANS.map((p) => ({ ref: p.venueSpaceRef, name: p.name }));
