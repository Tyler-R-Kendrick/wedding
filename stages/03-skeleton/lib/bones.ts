import { computeLayout, type ResponsiveBones, type SkeletonDescriptor, type SkeletonResult } from 'boneyard-js';

/**
 * Bones from the wireframe, not from a screenshot.
 *
 * boneyard normally captures bones by crawling a rendered page (`boneyard-js build`). This stage
 * comes BEFORE there is anything to crawl, so it uses boneyard's layout engine instead: each slot
 * a wireframe block declares (a paragraph of n lines, an image of some aspect, a one-line value)
 * becomes a `SkeletonDescriptor`, and `computeLayout` lays it out at the three capture widths.
 * Change the wireframe and the bones change with it on the next build — no capture step to forget.
 */

/** boneyard's default capture widths, which also match the pipeline's review widths. */
export const BREAKPOINTS = [375, 768, 1280] as const;

export type Shape =
  | { kind: 'text'; lines: number; lineHeight?: number }
  | { kind: 'media'; aspect: 'wide' | 'portrait' | 'square' }
  | { kind: 'line'; fraction?: number };

const RATIO = { wide: 16 / 9, portrait: 4 / 5, square: 1 } as const;
const LINE = 16;
const GAP = 12;

export function descriptorFor(shape: Shape, width: number): SkeletonDescriptor {
  switch (shape.kind) {
    case 'text': {
      const h = shape.lineHeight ?? LINE;
      return {
        display: 'flex',
        flexDirection: 'column',
        gap: GAP,
        children: Array.from({ length: shape.lines }, (_, i) =>
          i === shape.lines - 1 && shape.lines > 1 ? { height: h, maxWidth: Math.round(width * 0.62), borderRadius: 2 } : { height: h, borderRadius: 2 },
        ),
      };
    }
    case 'line':
      return { display: 'flex', children: [{ height: LINE, maxWidth: Math.round(width * (shape.fraction ?? 0.7)), borderRadius: 2 }] };
    case 'media':
      return { aspectRatio: RATIO[shape.aspect], borderRadius: 2 };
  }
}

/** computeLayout reports px; `<Skeleton>` positions x and w as percentages of its container. */
function toPercent(r: SkeletonResult): SkeletonResult {
  const w = r.width || 1;
  return {
    ...r,
    bones: r.bones.map((b) => {
      const o = Array.isArray(b) ? { x: b[0] as number, y: b[1] as number, w: b[2] as number, h: b[3] as number, r: b[4] as number | string } : b;
      return { ...o, x: (o.x / w) * 100, w: (o.w / w) * 100 };
    }),
  };
}

const cache = new Map<string, ResponsiveBones>();

export function bonesFor(shape: Shape): ResponsiveBones {
  const key = JSON.stringify(shape);
  let hit = cache.get(key);
  if (!hit) {
    hit = { breakpoints: Object.fromEntries(BREAKPOINTS.map((bp) => [bp, toPercent(computeLayout(descriptorFor(shape, bp), bp, key))])) };
    cache.set(key, hit);
  }
  return hit;
}
