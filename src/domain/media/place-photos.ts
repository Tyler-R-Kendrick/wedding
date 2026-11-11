import manifest from '../../../public/media/places/manifest.json';

/**
 * Photographs of the couple's recommended places, keyed by recommendation slug
 * (`public/media/places/manifest.json`, written by `scripts/place-photos.mjs` from files in the
 * licence ledger, `public/assets/attributions.json`). A slug that is not here has no photograph we
 * may publish, and its card shows none: a stand-in of somewhere else would be worse than nothing.
 *
 * `/credits` lists every ledger entry already (`src/domain/media/credits.ts`); `credit` is the line a
 * CC BY / BY-SA licence also asks to see beside the picture itself (null for CC0 / public domain).
 */

export interface PlacePhotoFile {
  src: string;
  format: 'avif' | 'webp';
  width: number;
  bytes: number;
  sha256: string;
}

export interface PlacePhoto {
  id: string;
  slug: string;
  /** The card-width WebP (640px, 4:3). */
  src: string;
  intrinsic: { width: number; height: number };
  /** Every rendition (640px and up to 1024px, AVIF and WebP), for a `srcset`. */
  files: PlacePhotoFile[];
  alt: string;
  ledger: { id: string; file: string; sha256: string };
  license: string;
  credit: string | null;
  creditUrl: string | null;
  /** The licence's own page, linked from its name in the credit (CC BY / BY-SA only). */
  licenseUrl: string | null;
}

const ITEMS = manifest.items as PlacePhoto[];
const BY_SLUG = new Map<string, PlacePhoto>(ITEMS.map((i) => [i.slug, i]));

export function placePhotos(): readonly PlacePhoto[] {
  return ITEMS;
}

export function placePhoto(slug: string): PlacePhoto | undefined {
  return BY_SLUG.get(slug);
}
