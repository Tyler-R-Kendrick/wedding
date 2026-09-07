import type { GalleryItem } from '@/capabilities/media';
import { Lightbox } from './Lightbox';
import { formatDuration, MediaEmpty } from './MediaShell';

/**
 * Responsive, lazy-loaded grid. Each tile is a button that opens the lightbox (client). Images
 * carry explicit dimensions (no layout shift) and the thumbnails are signed, short-lived URLs.
 */
export function GalleryGrid({ items, emptyMessage }: { items: GalleryItem[]; emptyMessage: string }) {
  if (items.length === 0) return <MediaEmpty>{emptyMessage}</MediaEmpty>;
  return <Lightbox items={items} />;
}

export function tileAlt(item: GalleryItem, index: number): string {
  if (item.altText) return item.altText;
  if (item.caption) return item.caption;
  return item.kind === 'video' ? `Video ${index + 1}` : `Photo ${index + 1}`;
}

export function tileBadge(item: GalleryItem): string | null {
  if (item.kind !== 'video') return null;
  const d = formatDuration(item.durationSeconds);
  return d ? `Video · ${d}` : 'Video';
}
