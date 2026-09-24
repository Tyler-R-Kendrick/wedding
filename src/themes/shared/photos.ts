import sizes from '@/content/photo-sizes.json';

const DIR = '/assets/photos/adventures/';
/** The width of the copies scripts/photo-renditions.mjs writes to `${DIR}800/`. */
const SMALL = 800;

/**
 * `srcset` for one of the couple's adventure photos: the 800px copy and the original at its real
 * width, so a postcard (at most 22rem wide) downloads a quarter of the pixels on most screens and a
 * phone at 3x still gets the sharp one. Undefined for any other image, and for a photo no wider than
 * the copy would be.
 */
export function photoSrcSet(src: string): string | undefined {
  if (!src.startsWith(DIR)) return undefined;
  const file = src.slice(DIR.length);
  const size = (sizes as Record<string, number[] | undefined>)[file];
  const width = size?.[0];
  if (!width || width <= SMALL) return undefined;
  return `${DIR}${SMALL}/${file} ${SMALL}w, ${src} ${width}w`;
}
