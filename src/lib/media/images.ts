import type { QualitySignals } from '@/db/schema/media';
import { dhashFromRaster } from './checksum';
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from './limits';

/**
 * Image processing with sharp. Every derivative is re-encoded from decoded pixels, auto-oriented,
 * and written without EXIF/XMP/IPTC (sharp strips unless `withMetadata` is called; we verify).
 * HEIC/HEIF is decoded through heic-convert first (sharp builds usually lack HEVC decoding).
 */
export type ImageVariant = 'thumb' | 'gallery' | 'web-full';

export const IMAGE_VARIANT_MAX_PX: Record<ImageVariant, number> = { thumb: 320, gallery: 1600, 'web-full': 2560 };

export interface BuiltDerivative {
  variant: ImageVariant | 'poster';
  format: 'webp' | 'jpeg';
  contentType: 'image/webp' | 'image/jpeg';
  bytes: Uint8Array;
  width: number;
  height: number;
  metadataStripped: boolean;
}

export interface ProcessedImage {
  width: number;
  height: number;
  dhash: string;
  derivatives: BuiltDerivative[];
  quality: QualitySignals;
  /** Raw EXIF segment from the original (for readImageMetadata on containers exifr cannot open). */
  exifSegment?: Uint8Array;
}

type SharpModule = typeof import('sharp').default;

async function sharp(): Promise<SharpModule> {
  const mod = await import('sharp');
  return mod.default;
}

const DECODE_OPTIONS = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' as const, sequentialRead: true };

/** HEIC/HEIF to JPEG bytes via heic-convert; other formats pass through untouched. */
export async function decodeForProcessing(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; converted: boolean }> {
  if (mime !== 'image/heic' && mime !== 'image/heif') return { bytes, converted: false };
  const { default: convert } = await import('heic-convert');
  const out = await convert({ buffer: Buffer.from(bytes), format: 'JPEG', quality: 0.92 });
  return { bytes: new Uint8Array(out), converted: true };
}

export interface ProcessImageOptions {
  variants?: ImageVariant[];
  /** Also produce a JPEG fallback next to each WebP (default: gallery and web-full). */
  jpegFallbackFor?: ImageVariant[];
}

/** Decodes once, then builds every variant (WebP + JPEG fallback), the dHash and quality signals. */
export async function processImage(decoded: Uint8Array, opts: ProcessImageOptions = {}): Promise<ProcessedImage> {
  const s = await sharp();
  const base = s(Buffer.from(decoded), DECODE_OPTIONS).rotate();
  const meta = await base.metadata();
  if (!meta.width || !meta.height) throw new Error('image has no dimensions');
  if (meta.width > MAX_IMAGE_DIMENSION || meta.height > MAX_IMAGE_DIMENSION) throw new Error('image dimensions exceed the limit');
  const oriented = (meta.orientation ?? 1) >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };

  const variants = opts.variants ?? (['thumb', 'gallery', 'web-full'] as ImageVariant[]);
  const jpegFor = new Set(opts.jpegFallbackFor ?? ['gallery', 'web-full']);
  const derivatives: BuiltDerivative[] = [];
  for (const variant of variants) {
    const max = IMAGE_VARIANT_MAX_PX[variant];
    const resized = base.clone().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
    const webp = await resized.clone().webp({ quality: variant === 'thumb' ? 78 : 82, effort: 4 }).toBuffer({ resolveWithObject: true });
    derivatives.push({ variant, format: 'webp', contentType: 'image/webp', bytes: new Uint8Array(webp.data), width: webp.info.width, height: webp.info.height, metadataStripped: await isStripped(s, webp.data) });
    if (jpegFor.has(variant)) {
      const jpeg = await resized.clone().jpeg({ quality: 84, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      derivatives.push({ variant, format: 'jpeg', contentType: 'image/jpeg', bytes: new Uint8Array(jpeg.data), width: jpeg.info.width, height: jpeg.info.height, metadataStripped: await isStripped(s, jpeg.data) });
    }
  }

  const raster = await base.clone().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  const dhash = dhashFromRaster(new Uint8Array(raster), 9, 8);
  const quality = await computeQualitySignals(decoded);
  return { width: oriented.width, height: oriented.height, dhash, derivatives, quality, exifSegment: meta.exif ? new Uint8Array(meta.exif) : undefined };
}

/** Builds thumb + poster derivatives from a video frame. */
export async function processPoster(posterBytes: Uint8Array): Promise<{ derivatives: BuiltDerivative[]; width: number; height: number }> {
  const s = await sharp();
  const base = s(Buffer.from(posterBytes), DECODE_OPTIONS).rotate();
  const derivatives: BuiltDerivative[] = [];
  const thumb = await base.clone().resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
  derivatives.push({ variant: 'thumb', format: 'webp', contentType: 'image/webp', bytes: new Uint8Array(thumb.data), width: thumb.info.width, height: thumb.info.height, metadataStripped: await isStripped(s, thumb.data) });
  const poster = await base.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  derivatives.push({ variant: 'poster', format: 'jpeg', contentType: 'image/jpeg', bytes: new Uint8Array(poster.data), width: poster.info.width, height: poster.info.height, metadataStripped: await isStripped(s, poster.data) });
  return { derivatives, width: poster.info.width, height: poster.info.height };
}

/** Numeric signals only; the UI never turns them into "good"/"bad" claims. */
export async function computeQualitySignals(decoded: Uint8Array): Promise<QualitySignals> {
  const s = await sharp();
  const grey = s(Buffer.from(decoded), DECODE_OPTIONS).rotate().greyscale().resize({ width: 256, withoutEnlargement: true });
  const { data, info } = await grey.clone().raw().toBuffer({ resolveWithObject: true });
  const total = info.width * info.height;
  let sum = 0;
  let high = 0;
  let low = 0;
  for (let i = 0; i < total; i++) {
    const v = data[i]!;
    sum += v;
    if (v >= 250) high++;
    if (v <= 5) low++;
  }
  const lap = await grey.clone().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).raw().toBuffer({ resolveWithObject: true });
  const stats = await s(lap.data, { raw: { width: lap.info.width, height: lap.info.height, channels: 1 } }).stats();
  const stdev = stats.channels[0]?.stdev ?? 0;
  return {
    sharpness: round(stdev * stdev, 1),
    meanLuma: round(sum / Math.max(1, total), 1),
    clippedHighlights: round(high / Math.max(1, total), 4),
    clippedShadows: round(low / Math.max(1, total), 4),
  };
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** True when the encoded bytes carry no EXIF/XMP/IPTC segment. */
export async function isStripped(s: SharpModule, bytes: Buffer | Uint8Array): Promise<boolean> {
  const m = await s(Buffer.from(bytes)).metadata();
  return !m.exif && !m.xmp && !m.iptc;
}

export async function imageIsStripped(bytes: Uint8Array): Promise<boolean> {
  return isStripped(await sharp(), bytes);
}

/** Raw EXIF segment of an image (undefined when absent). */
export async function exifSegmentOf(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  const s = await sharp();
  try {
    const m = await s(Buffer.from(bytes), DECODE_OPTIONS).metadata();
    return m.exif ? new Uint8Array(m.exif) : undefined;
  } catch {
    return undefined;
  }
}
