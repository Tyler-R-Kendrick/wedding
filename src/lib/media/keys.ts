/**
 * Storage layout (ADR-0005). Every key is built here; nothing else concatenates paths.
 *
 *   quarantine/<uploadId>/original                raw upload before validation (system only)
 *   originals/guest/<guestId>/<assetId>.<ext>     validated guest originals (uploader + admin)
 *   originals/professional/<vendor>/<assetId>.<ext>  professional deliveries (admin only)
 *   derivatives/thumb|gallery|web-full|poster|video-web/<assetId>.<ext>  the only keys ever served
 *   archive/<year>/manifests/<kind>/<id>.json     cold manifests (admin only)
 */
import { isValidKey } from '@/providers/storage/types';
import { MAX_FILENAME_CHARS } from './limits';

export const STORAGE_PREFIXES = {
  quarantine: 'quarantine',
  originalsGuest: 'originals/guest',
  originalsProfessional: 'originals/professional',
  derivatives: 'derivatives',
  archive: 'archive',
} as const;

export const SERVABLE_PREFIX = `${STORAGE_PREFIXES.derivatives}/`;

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A path segment we generated or validated: no separators, no dots-only, bounded length. */
export function assertSegment(value: string, what = 'segment'): string {
  if (!SEGMENT.test(value) || value.includes('..')) throw new Error(`invalid storage ${what}`);
  return value;
}

export function quarantineKey(uploadId: string): string {
  return `${STORAGE_PREFIXES.quarantine}/${assertSegment(uploadId, 'upload id')}/original`;
}

export function originalKey(input: { source: 'guest' | 'couple' | 'professional'; ownerGuestId?: string | null; vendor?: string | null; assetId: string; ext: string }): string {
  const id = assertSegment(input.assetId, 'asset id');
  const ext = assertSegment(input.ext, 'extension');
  if (input.source === 'professional') {
    return `${STORAGE_PREFIXES.originalsProfessional}/${assertSegment(input.vendor ?? 'unknown-vendor', 'vendor')}/${id}.${ext}`;
  }
  const owner = input.source === 'couple' ? 'couple' : assertSegment(input.ownerGuestId ?? 'unknown', 'guest id');
  return `${STORAGE_PREFIXES.originalsGuest}/${owner}/${id}.${ext}`;
}

export type DerivativeVariantKey = 'thumb' | 'gallery' | 'web-full' | 'poster' | 'video-web';

export function derivativeKey(variant: DerivativeVariantKey, assetId: string, ext: string): string {
  return `${STORAGE_PREFIXES.derivatives}/${variant}/${assertSegment(assetId, 'asset id')}.${assertSegment(ext, 'extension')}`;
}

export function archiveManifestKey(year: number, kind: 'deletions' | 'imports', id: string): string {
  return `${STORAGE_PREFIXES.archive}/${year}/manifests/${kind}/${assertSegment(id, 'id')}.json`;
}

/** Only derivatives may ever be signed for reading. */
export function isServableKey(key: string): boolean {
  return isValidKey(key) && key.startsWith(SERVABLE_PREFIX) && !key.includes('..');
}

export function isQuarantineKey(key: string): boolean {
  return key.startsWith(`${STORAGE_PREFIXES.quarantine}/`);
}

/** Display-only file name: strip directories, control characters, and bound the length. Never used in a key. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();
  const trimmed = clean.length > MAX_FILENAME_CHARS ? clean.slice(0, MAX_FILENAME_CHARS) : clean;
  return trimmed || 'untitled';
}

export function vendorSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug || 'unknown-vendor';
}
