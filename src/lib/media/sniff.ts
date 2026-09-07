import { isAllowedMime, kindForMime, EXTENSION_FOR_MIME, type AllowedMime, type MediaKindOf } from './limits';
import { walkMp4 } from './mp4';

/**
 * Content sniffing independent of file name and declared type. The allowlist is
 * JPEG/PNG/WebP/HEIC/HEIF and MP4/MOV. Anything else (SVG, executables, archives, scripts,
 * unknown bytes) is rejected, and so are polyglots: image files carrying an archive,
 * executable or markup payload, and ISO-BMFF files with data outside the box structure.
 */
export type SniffRejectReason = 'empty' | 'unknown_type' | 'disallowed_type' | 'polyglot' | 'structure';

export type SniffResult =
  | { ok: true; mime: AllowedMime; kind: MediaKindOf; ext: string; trailingBytes: number }
  | { ok: false; reason: SniffRejectReason; message: string; detectedMime?: string };

const GUEST_MESSAGES: Record<SniffRejectReason, string> = {
  empty: 'That file is empty.',
  unknown_type: 'We could not recognise that file. Photos (JPEG, PNG, WebP, HEIC) and videos (MP4, MOV) are welcome.',
  disallowed_type: 'That kind of file is not supported here. Photos (JPEG, PNG, WebP, HEIC) and videos (MP4, MOV) are welcome.',
  polyglot: 'That file contains extra data we cannot accept. Please export it again from your camera roll and retry.',
  structure: 'That file looks damaged. Please export it again from your camera roll and retry.',
};

function ascii(s: string): Uint8Array {
  return new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));
}

/** Byte signatures that must never appear in a file we accept. `anywhere` scans the whole file; otherwise offset 0 only. */
const DANGEROUS_SIGNATURES: { name: string; bytes: Uint8Array; anywhere: boolean; textual: boolean }[] = [
  { name: 'zip', bytes: ascii('PK\x03\x04'), anywhere: true, textual: false },
  { name: 'zip-empty', bytes: ascii('PK\x05\x06'), anywhere: true, textual: false },
  { name: 'rar', bytes: ascii('Rar!\x1a\x07'), anywhere: true, textual: false },
  { name: '7z', bytes: new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), anywhere: true, textual: false },
  { name: 'gzip', bytes: new Uint8Array([0x1f, 0x8b, 0x08]), anywhere: false, textual: false },
  { name: 'pe', bytes: ascii('MZ'), anywhere: false, textual: false },
  { name: 'elf', bytes: new Uint8Array([0x7f, 0x45, 0x4c, 0x46]), anywhere: true, textual: false },
  { name: 'macho', bytes: new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]), anywhere: true, textual: false },
  { name: 'shebang', bytes: ascii('#!/'), anywhere: false, textual: false },
  { name: 'php', bytes: ascii('<?php'), anywhere: true, textual: true },
  { name: 'script', bytes: ascii('<script'), anywhere: true, textual: true },
  { name: 'html', bytes: ascii('<html'), anywhere: true, textual: true },
  { name: 'doctype', bytes: ascii('<!doctype html'), anywhere: true, textual: true },
  { name: 'svg', bytes: ascii('<svg'), anywhere: true, textual: true },
];

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0, caseInsensitive = false): number {
  const first = needle[0]!;
  const alt = caseInsensitive && first >= 0x61 && first <= 0x7a ? first - 32 : first;
  outer: for (let i = from; i <= hay.byteLength - needle.byteLength; i++) {
    const c = hay[i]!;
    if (c !== first && c !== alt) continue;
    for (let j = 1; j < needle.byteLength; j++) {
      let h = hay[i + j]!;
      if (caseInsensitive && h >= 0x41 && h <= 0x5a) h += 32;
      if (h !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Name of the first dangerous signature found at or after `from`, or null. Markup checks are case-insensitive. */
export function findDangerousSignature(bytes: Uint8Array, from = 0): string | null {
  for (const sig of DANGEROUS_SIGNATURES) {
    if (sig.anywhere) {
      if (indexOfBytes(bytes, sig.bytes, from, sig.textual) >= 0) return sig.name;
    } else if (from === 0 && bytes.byteLength >= sig.bytes.byteLength && sig.bytes.every((b, i) => bytes[i] === b)) {
      return sig.name;
    }
  }
  return null;
}

/** End offset (exclusive) of a JPEG stream = position after the last FFD9, or -1. */
export function jpegEnd(bytes: Uint8Array): number {
  for (let i = bytes.byteLength - 2; i >= 2; i--) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return i + 2;
  }
  return -1;
}

/** Walks PNG chunks; returns the end offset after IEND, or -1 when the structure is broken. */
export function pngEnd(bytes: Uint8Array): number {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 8 + 12 || !sig.every((b, i) => bytes[i] === b)) return -1;
  let at = 8;
  while (at + 12 <= bytes.byteLength) {
    const len = ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const next = at + 12 + len;
    if (next > bytes.byteLength) return -1;
    if (type === 'IEND') return next;
    at = next;
  }
  return -1;
}

/** RIFF container end for WebP (RIFF size + 8, padded to even). */
export function webpEnd(bytes: Uint8Array): number {
  if (bytes.byteLength < 12) return -1;
  const size = bytes[4]! + (bytes[5]! << 8) + (bytes[6]! << 16) + ((bytes[7]! << 24) >>> 0);
  const end = 8 + size + (size % 2);
  return end <= bytes.byteLength ? end : -1;
}

export async function sniffMedia(bytes: Uint8Array): Promise<SniffResult> {
  if (bytes.byteLength === 0) return reject('empty');
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected) return reject('unknown_type');
  const mime = detected.mime as string;
  if (!isAllowedMime(mime)) return reject('disallowed_type', mime);
  const kind = kindForMime(mime)!;

  let end: number;
  switch (mime) {
    case 'image/jpeg':
      end = jpegEnd(bytes);
      if (end < 0) return reject('structure', mime);
      break;
    case 'image/png':
      end = pngEnd(bytes);
      if (end < 0) return reject('structure', mime);
      break;
    case 'image/webp':
      end = webpEnd(bytes);
      if (end < 0) return reject('structure', mime);
      break;
    case 'image/heic':
    case 'image/heif': {
      const walked = walkMp4(bytes, { requireMoov: false });
      if (!walked.ok) return reject(walked.reason === 'trailing_data' ? 'polyglot' : 'structure', mime);
      end = bytes.byteLength;
      break;
    }
    case 'video/mp4':
    case 'video/quicktime': {
      const walked = walkMp4(bytes);
      if (!walked.ok) return reject(walked.reason === 'trailing_data' ? 'polyglot' : 'structure', mime);
      end = bytes.byteLength;
      break;
    }
    default:
      return reject('disallowed_type', mime);
  }

  // Executables, archives and markup are never acceptable anywhere in the file.
  // (Metadata segments legitimately contain XMP, which none of these signatures match.)
  if (findDangerousSignature(bytes) !== null) return reject('polyglot', mime);
  // Trailing bytes after the image end are tolerated only when they are not a payload we
  // recognise (e.g. phone "motion photo" trailers). Originals are never served either way.
  const trailingBytes = bytes.byteLength - end;
  return { ok: true, mime, kind, ext: EXTENSION_FOR_MIME[mime], trailingBytes };
}

function reject(reason: SniffRejectReason, detectedMime?: string): SniffResult {
  return { ok: false, reason, message: GUEST_MESSAGES[reason], ...(detectedMime ? { detectedMime } : {}) };
}
