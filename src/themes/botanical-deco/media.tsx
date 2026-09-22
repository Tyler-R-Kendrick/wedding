import manifest from '../../../public/media/botanical-deco/manifest.json';

/**
 * The approved design's media, by slot id (`public/media/botanical-deco/manifest.json`, written by
 * `scripts/botanical-deco-media.mjs`). A recipe names a slot — `couple.hero.formal`,
 * `botanical.corner-tl`, `venue.exterior` — and never a file path, so replacing an interim crop with
 * the final portrait is a manifest change and nothing else.
 *
 * Every photograph is a `<picture>` with AVIF first and a JPEG fallback, explicit intrinsic size (no
 * layout shift), and an optional art-directed phone crop: the approved Home keeps both partners in
 * frame at 390px, which a centre crop of the desktop image does not.
 */

interface MediaFile {
  src: string;
  format: string;
  width: number;
}
interface MediaItem {
  id: string;
  kind: string;
  sourceType: string;
  interim?: boolean;
  intrinsic: { width: number; height: number };
  aspect: number;
  focal?: number[];
  alt: string;
  caption?: string | null;
  credit?: string;
  files: MediaFile[];
}

const ITEMS = new Map<string, MediaItem>((manifest.items as MediaItem[]).map((i) => [i.id, i]));

export function mediaItem(id: string): MediaItem | undefined {
  return ITEMS.get(id);
}

function srcset(item: MediaItem, format: string): string {
  return item.files
    .filter((f) => f.format === format)
    .sort((a, b) => a.width - b.width)
    .map((f) => `${f.src} ${f.width}w`)
    .join(', ');
}

function fallback(item: MediaItem): MediaFile | undefined {
  const jpgs = item.files.filter((f) => f.format === 'jpg').sort((a, b) => a.width - b.width);
  return jpgs[0] ?? item.files[0];
}

const focalPosition = (item: MediaItem) => (item.focal ? `${Math.round((item.focal[0] ?? 0.5) * 100)}% ${Math.round((item.focal[1] ?? 0.5) * 100)}%` : undefined);

export interface PhotoProps {
  /** A slot id, or several in order of preference: the first one the manifest has is used. */
  id: string | readonly string[];
  /** Art-directed phone crop, used below 768px. */
  mobileId?: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  /** Overrides the manifest's alt text; pass `''` only when the same picture is described next to it. */
  alt?: string;
}

/** A manifest photograph. Renders nothing for an unknown slot rather than a broken image. */
export function firstMedia(id: string | readonly string[]): MediaItem | undefined {
  for (const i of typeof id === 'string' ? [id] : id) {
    const item = ITEMS.get(i);
    if (item) return item;
  }
  return undefined;
}

export function Photo({ id, mobileId, sizes, priority, className, alt }: PhotoProps) {
  const item = firstMedia(id);
  if (!item) return null;
  const mobile = mobileId ? ITEMS.get(mobileId) : undefined;
  const img = fallback(item);
  if (!img) return null;
  return (
    <picture className={className} data-media={item.id} data-interim={item.interim ? 'true' : undefined}>
      {mobile ? <source media="(max-width: 767px)" type="image/avif" srcSet={srcset(mobile, 'avif')} sizes="100vw" /> : null}
      {mobile ? <source media="(max-width: 767px)" type="image/jpeg" srcSet={srcset(mobile, 'jpg')} sizes="100vw" /> : null}
      <source type="image/avif" srcSet={srcset(item, 'avif')} sizes={sizes} />
      {/* Art-directed <picture>: next/image cannot express a different crop per breakpoint. */}
      <img
        src={img.src}
        srcSet={srcset(item, 'jpg')}
        sizes={sizes}
        width={item.intrinsic.width}
        height={item.intrinsic.height}
        alt={alt ?? item.alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        fetchPriority={priority ? 'high' : undefined}
        style={{ objectPosition: focalPosition(item) }}
      />
    </picture>
  );
}

/**
 * An edge botanical: decorative, so empty alt and hidden from assistive technology. The CSS places
 * it (`.bd-bloom--<slot>`); the markup only says which painting.
 */
export function Botanical({ id, className, priority }: { id: string; className?: string; priority?: boolean }) {
  const item = ITEMS.get(id);
  if (!item) return null;
  const files = item.files.filter((f) => f.format === 'webp').sort((a, b) => a.width - b.width);
  const base = files[0];
  if (!base) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- decorative cut-out; density descriptors are enough
    <img
      className={`bd-bloom ${className ?? ''}`.trim()}
      src={base.src}
      srcSet={files.map((f, i) => `${f.src} ${i + 1}x`).join(', ')}
      width={item.intrinsic.width}
      height={item.intrinsic.height}
      alt=""
      aria-hidden="true"
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      data-media={item.id}
    />
  );
}
