import { createHash } from 'node:crypto';

/** SHA-256 hex of the whole object (the authoritative duplicate key). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Client-side quick fingerprint mirror: sha256(size || first 256 KiB || last 64 KiB). The browser
 * computes the same over the File; it lets `create_upload` short-circuit obvious re-uploads without
 * hashing gigabytes in the browser. Never used as the dedupe key on its own.
 */
export const FINGERPRINT_HEAD_BYTES = 256 * 1024;
export const FINGERPRINT_TAIL_BYTES = 64 * 1024;

export function quickFingerprint(bytes: Uint8Array): string {
  const h = createHash('sha256');
  h.update(String(bytes.byteLength));
  h.update(bytes.subarray(0, Math.min(bytes.byteLength, FINGERPRINT_HEAD_BYTES)));
  if (bytes.byteLength > FINGERPRINT_HEAD_BYTES) h.update(bytes.subarray(Math.max(FINGERPRINT_HEAD_BYTES, bytes.byteLength - FINGERPRINT_TAIL_BYTES)));
  return h.digest('hex');
}

/** 64-bit difference hash from a 9x8 greyscale raster (row-major, one byte per pixel). */
export function dhashFromRaster(pixels: Uint8Array, width = 9, height = 8): string {
  if (pixels.byteLength < width * height) throw new Error('dhash raster too small');
  let bits = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = pixels[y * width + x]!;
      const right = pixels[y * width + x + 1]!;
      bits += left < right ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Near-duplicate threshold on the 64-bit dHash (<= 6 differing bits: same frame, minor edits). */
export const NEAR_DUPLICATE_MAX_DISTANCE = 6;
