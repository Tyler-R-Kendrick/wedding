import sharp from 'sharp';
import { buildSyntheticMp4 } from '../../src/lib/media/mp4';

/** A JPEG carrying camera EXIF and GPS coordinates (what a phone upload looks like). */
export async function jpegWithGps(opts: { width?: number; height?: number; quality?: number; noise?: boolean } = {}): Promise<Uint8Array> {
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  const base = opts.noise ? sharp(noiseRaster(width, height), { raw: { width, height, channels: 3 } }) : sharp({ create: { width, height, channels: 3, background: { r: 120, g: 84, b: 40 } } });
  const buf = await base
    .jpeg({ quality: opts.quality ?? 80 })
    .withExif({
      IFD0: { Make: 'Fixture', Model: 'FixtureCam', DateTime: '2027:07:17 18:30:00' },
      IFD2: { DateTimeOriginal: '2027:07:17 18:30:00' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 52/1 55/1', GPSLongitudeRef: 'W', GPSLongitude: '87/1 37/1 27/1', GPSVersionID: '2 3 0 0' },
    })
    .toBuffer();
  return new Uint8Array(buf);
}

export async function plainJpeg(width = 320, height = 240, tone = 90): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: tone, g: tone + 40, b: tone + 80 } } }).jpeg({ quality: 80 }).toBuffer());
}

export async function plainPng(width = 64, height = 48): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 4, background: { r: 10, g: 200, b: 100, alpha: 1 } } }).png().toBuffer());
}

export async function plainWebp(width = 64, height = 48): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 20, b: 100 } } }).webp().toBuffer());
}

/** Deterministic pseudo-noise so JPEGs compress poorly (for multipart tests). */
export function noiseRaster(width: number, height: number): Buffer {
  const out = Buffer.alloc(width * height * 3);
  let x = 123456789;
  for (let i = 0; i < out.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

export function syntheticMp4(opts: Parameters<typeof buildSyntheticMp4>[0] = {}): Uint8Array {
  return buildSyntheticMp4({ location: '+41.8789-087.6243/', durationSeconds: 3, width: 640, height: 360, ...opts });
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

export const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));

export const ZIP_LOCAL_HEADER = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const ZIP_EOCD = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const PE_HEADER = concat(ascii('MZ'), new Uint8Array(120).fill(0x90));
export const ELF_HEADER = concat(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), new Uint8Array(56).fill(0));
