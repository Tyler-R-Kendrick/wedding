import { describe, expect, it } from 'vitest';
import { dhashFromRaster, hammingHex, quickFingerprint, sha256Hex } from '@/lib/media/checksum';
import { archiveManifestKey, assertSegment, derivativeKey, isQuarantineKey, isServableKey, originalKey, quarantineKey, sanitizeFilename, vendorSlug } from '@/lib/media/keys';
import { checkSize, DEFAULT_LIMITS, formatBytes, hintMime, kindForMime, limitsFromEnv, MiB, planUpload } from '@/lib/media/limits';

describe('limits', () => {
  it('caps by kind and plans multipart uploads', () => {
    expect(checkSize('image', 10 * MiB)).toEqual({ ok: true });
    expect(checkSize('image', DEFAULT_LIMITS.maxImageBytes + 1)).toMatchObject({ ok: false, reason: 'too_large' });
    expect(checkSize('video', 0)).toMatchObject({ ok: false, reason: 'empty' });
    expect(checkSize('video', 100 * MiB)).toEqual({ ok: true });
    expect(planUpload(3 * MiB)).toEqual({ multipart: false, partSize: 3 * MiB, partCount: 1 });
    expect(planUpload(8 * MiB)).toEqual({ multipart: false, partSize: 8 * MiB, partCount: 1 });
    expect(planUpload(8 * MiB + 1)).toEqual({ multipart: true, partSize: 8 * MiB, partCount: 2 });
    expect(planUpload(100 * MiB)).toMatchObject({ multipart: true, partCount: 13 });
    const small = limitsFromEnv({ MEDIA_MAX_IMAGE_MB: 1, MEDIA_MAX_VIDEO_MB: 2, MEDIA_PART_SIZE_MB: 1, MEDIA_MULTIPART_THRESHOLD_MB: 1 });
    expect(planUpload(2.5 * MiB, small)).toEqual({ multipart: true, partSize: MiB, partCount: 3 });
    expect(checkSize('image', 1.5 * MiB, small)).toMatchObject({ ok: false, maxBytes: MiB });
  });

  it('hints a mime from the declared type or the extension, never trusting either for acceptance', () => {
    expect(hintMime('image/jpeg', 'x.bin')).toBe('image/jpeg');
    expect(hintMime('', 'IMG_0001.HEIC')).toBe('image/heic');
    expect(hintMime('application/octet-stream', 'clip.MOV')).toBe('video/quicktime');
    expect(hintMime('image/svg+xml', 'x.svg')).toBeNull();
    expect(hintMime('', 'x.exe')).toBeNull();
    expect(kindForMime('video/quicktime')).toBe('video');
    expect(kindForMime('application/zip')).toBeNull();
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(2.5 * MiB)).toBe('2.5 MB');
  });
});

describe('storage keys', () => {
  const id = '01J8ZQ4Y0H5X0Q0Y0Z0A0B0C0D';
  it('builds the ADR-0005 layout and only derivatives are servable', () => {
    expect(quarantineKey(id)).toBe(`quarantine/${id}/original`);
    expect(originalKey({ source: 'guest', ownerGuestId: 'G1', assetId: id, ext: 'jpg' })).toBe(`originals/guest/G1/${id}.jpg`);
    expect(originalKey({ source: 'professional', vendor: 'oakhouse-visuals', assetId: id, ext: 'mov' })).toBe(`originals/professional/oakhouse-visuals/${id}.mov`);
    expect(originalKey({ source: 'couple', assetId: id, ext: 'png' })).toBe(`originals/guest/couple/${id}.png`);
    expect(derivativeKey('thumb', id, 'webp')).toBe(`derivatives/thumb/${id}.webp`);
    expect(archiveManifestKey(2027, 'deletions', id)).toBe(`archive/2027/manifests/deletions/${id}.json`);
    expect(isServableKey(`derivatives/gallery/${id}.webp`)).toBe(true);
    expect(isServableKey(`originals/guest/G1/${id}.jpg`)).toBe(false);
    expect(isServableKey(`quarantine/${id}/original`)).toBe(false);
    expect(isServableKey('derivatives/../originals/guest/G1/x.jpg')).toBe(false);
    expect(isServableKey('derivatives//thumb/x.webp')).toBe(false);
    expect(isQuarantineKey(`quarantine/${id}/original`)).toBe(true);
  });

  it('refuses traversal in any segment we build from input', () => {
    for (const bad of ['..', 'a/b', '../x', '', 'x'.repeat(65), '.hidden', ' space']) {
      expect(() => assertSegment(bad), bad).toThrow();
    }
    expect(() => originalKey({ source: 'guest', ownerGuestId: '../admin', assetId: id, ext: 'jpg' })).toThrow();
    expect(() => derivativeKey('thumb', id, 'jpg/../../x')).toThrow();
  });

  it('sanitizes display file names and vendor slugs', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\me\\IMG 001.HEIC')).toBe('IMG 001.HEIC');
    expect(sanitizeFilename('bad\x00name\x1f.jpg')).toBe('badname.jpg');
    expect(sanitizeFilename('')).toBe('untitled');
    expect(sanitizeFilename('x'.repeat(300))).toHaveLength(120);
    expect(vendorSlug('Brooke Alaina Photography')).toBe('brooke-alaina-photography');
    expect(vendorSlug('///')).toBe('unknown-vendor');
  });
});

describe('checksums', () => {
  it('hashes and fingerprints deterministically', () => {
    const a = new Uint8Array(400 * 1024).fill(1);
    const b = new Uint8Array(400 * 1024).fill(1);
    b[300 * 1024] = 2; // middle change is invisible to the quick fingerprint but not to sha256
    expect(sha256Hex(a)).toHaveLength(64);
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
    expect(quickFingerprint(a)).toBe(quickFingerprint(b));
    const c = new Uint8Array(400 * 1024).fill(1);
    c[c.length - 1] = 9;
    expect(quickFingerprint(a)).not.toBe(quickFingerprint(c));
  });

  it('dhash + hamming distance', () => {
    const raster = new Uint8Array(72);
    for (let i = 0; i < 72; i++) raster[i] = (i % 9) * 20; // increasing across each row
    const h = dhashFromRaster(raster);
    expect(h).toBe('f'.repeat(16));
    expect(hammingHex(h, h)).toBe(0);
    expect(hammingHex('0'.repeat(16), 'f'.repeat(16))).toBe(64);
    expect(hammingHex('00', 'ff')).toBe(8);
    expect(() => dhashFromRaster(new Uint8Array(10))).toThrow();
  });
});
