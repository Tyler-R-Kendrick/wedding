import { describe, expect, it } from 'vitest';
import { hasLocationMetadata, readImageMetadata } from '@/lib/media/exif';
import { computeQualitySignals, decodeForProcessing, exifSegmentOf, imageIsStripped, processImage, processPoster } from '@/lib/media/images';
import { sniffMedia } from '@/lib/media/sniff';
import { placeholderPosterPng } from '@/providers/video/placeholder';
import { jpegWithGps, plainJpeg, plainPng } from '../../helpers/media-fixtures';

describe('image pipeline (sharp)', () => {
  it('reads capture metadata from the original and never keeps coordinates', async () => {
    const original = await jpegWithGps();
    const meta = await readImageMetadata(original);
    expect(meta.hadLocation).toBe(true);
    expect(meta.make).toBe('Fixture');
    expect(meta.model).toBe('FixtureCam');
    expect(meta.capturedAt?.toISOString()).toBe('2027-07-17T18:30:00.000Z');
    expect(JSON.stringify(meta)).not.toMatch(/latitude|longitude|41\.8/);
    expect(await hasLocationMetadata(await plainJpeg())).toBe(false);
  });

  it('produces derivatives with no EXIF/GPS, correct sizes, a dhash and quality signals', async () => {
    const original = await jpegWithGps({ width: 3000, height: 2000 });
    expect(await imageIsStripped(original)).toBe(false);
    const out = await processImage(original);
    expect(out.width).toBe(3000);
    expect(out.height).toBe(2000);
    expect(out.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(out.derivatives.map((d) => `${d.variant}/${d.format}`)).toEqual(['thumb/webp', 'gallery/webp', 'gallery/jpeg', 'web-full/webp', 'web-full/jpeg']);
    for (const d of out.derivatives) {
      expect(d.metadataStripped, d.variant).toBe(true);
      expect(await imageIsStripped(d.bytes)).toBe(true);
      expect(await hasLocationMetadata(d.bytes, await exifSegmentOf(d.bytes))).toBe(false);
      const sniffed = await sniffMedia(d.bytes);
      expect(sniffed.ok && sniffed.mime).toBe(d.contentType);
    }
    const thumb = out.derivatives[0]!;
    expect(Math.max(thumb.width, thumb.height)).toBeLessThanOrEqual(320);
    const gallery = out.derivatives.find((d) => d.variant === 'gallery')!;
    expect(gallery.width).toBe(1600);
    const full = out.derivatives.find((d) => d.variant === 'web-full')!;
    expect(full.width).toBe(2560);
    expect(out.quality.meanLuma).toBeGreaterThan(0);
    expect(out.quality.sharpness).toBeGreaterThanOrEqual(0);
    expect(out.quality.clippedHighlights).toBeGreaterThanOrEqual(0);
  });

  it('does not enlarge small images and keeps PNG alpha sources decodable', async () => {
    const out = await processImage(await plainPng(64, 48));
    for (const d of out.derivatives) expect(d.width).toBe(64);
    const q = await computeQualitySignals(await plainPng(64, 48));
    expect(q.clippedShadows).toBe(0);
  });

  it('builds thumb + poster from a placeholder frame', async () => {
    const poster = await processPoster(placeholderPosterPng());
    expect(poster.derivatives.map((d) => d.variant)).toEqual(['thumb', 'poster']);
    expect(poster.width).toBe(320);
    expect(poster.height).toBe(180);
  });

  it('passes non-HEIC bytes through decodeForProcessing untouched', async () => {
    const jpeg = await plainJpeg();
    const r = await decodeForProcessing(jpeg, 'image/jpeg');
    expect(r.converted).toBe(false);
    expect(r.bytes).toBe(jpeg);
  });
});
