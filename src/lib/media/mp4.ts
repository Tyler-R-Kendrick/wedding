/**
 * Minimal ISO-BMFF (MP4 / QuickTime / HEIF) box walker. Three jobs:
 *  1. structure validation: boxes must tile the file exactly (trailing data = polyglot);
 *  2. probing: duration and track dimensions from mvhd/tkhd;
 *  3. metadata stripping without re-muxing: udta/meta/uuid/xtra boxes are renamed to `free`
 *     and zero-filled, so sizes and chunk offsets (stco/co64) stay valid. Works without ffmpeg.
 */
export interface Box {
  type: string;
  /** Absolute offset of the box header. */
  offset: number;
  /** Total size including header. */
  size: number;
  headerSize: number;
}

export type WalkResult = { ok: true; boxes: Box[] } | { ok: false; reason: 'too_short' | 'bad_box' | 'trailing_data' | 'no_ftyp' | 'no_moov' };

const TYPE_CHARS = /^[\x20-\x7e]{4}$/;
const COPYRIGHT_SIGN = 0xa9; // QuickTime user-data atoms such as (c)xyz start with this byte.

function readType(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

function readU32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
}

function readU64(bytes: Uint8Array, at: number): number {
  return readU32(bytes, at) * 2 ** 32 + readU32(bytes, at + 4);
}

function validType(bytes: Uint8Array, at: number, type: string): boolean {
  return TYPE_CHARS.test(type) || bytes[at + 4] === COPYRIGHT_SIGN;
}

/** Boxes between [start, end). Returns null when a header is malformed or the boxes do not tile the range. */
export function listBoxes(bytes: Uint8Array, start: number, end: number): Box[] | null {
  const out: Box[] = [];
  let at = start;
  while (at < end) {
    if (end - at < 8) return null;
    let size = readU32(bytes, at);
    const type = readType(bytes, at + 4);
    if (!validType(bytes, at, type)) return null;
    let headerSize = 8;
    if (size === 1) {
      if (end - at < 16) return null;
      size = readU64(bytes, at + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < headerSize || at + size > end) return null;
    out.push({ type, offset: at, size, headerSize });
    at += size;
  }
  return at === end ? out : null;
}

/** Validates that top-level boxes tile the whole file, starting with ftyp and (by default) containing moov. */
export function walkMp4(bytes: Uint8Array, opts: { requireMoov?: boolean } = {}): WalkResult {
  if (bytes.byteLength < 16) return { ok: false, reason: 'too_short' };
  const boxes = listBoxes(bytes, 0, bytes.byteLength);
  if (!boxes) {
    const partial = longestValidPrefix(bytes);
    return { ok: false, reason: partial > 0 && partial < bytes.byteLength ? 'trailing_data' : 'bad_box' };
  }
  if (boxes[0]?.type !== 'ftyp') return { ok: false, reason: 'no_ftyp' };
  if ((opts.requireMoov ?? true) && !boxes.some((b) => b.type === 'moov')) return { ok: false, reason: 'no_moov' };
  return { ok: true, boxes };
}

function longestValidPrefix(bytes: Uint8Array): number {
  let at = 0;
  const end = bytes.byteLength;
  while (at < end) {
    if (end - at < 8) return at;
    let size = readU32(bytes, at);
    let headerSize = 8;
    if (size === 1) {
      if (end - at < 16) return at;
      size = readU64(bytes, at + 8);
      headerSize = 16;
    } else if (size === 0) size = end - at;
    const type = readType(bytes, at + 4);
    if (size < headerSize || at + size > end || !validType(bytes, at, type)) return at;
    at += size;
  }
  return at;
}

export function findBox(boxes: Box[], type: string): Box | undefined {
  return boxes.find((b) => b.type === type);
}

export function childrenOf(bytes: Uint8Array, box: Box): Box[] {
  return listBoxes(bytes, box.offset + box.headerSize, box.offset + box.size) ?? [];
}

export interface Mp4Probe {
  brand: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

/** Duration from mvhd; the largest track dimensions from tkhd (video tracks carry non-zero sizes). */
export function probeMp4(bytes: Uint8Array): Mp4Probe | null {
  const walked = walkMp4(bytes);
  if (!walked.ok) return null;
  const ftyp = findBox(walked.boxes, 'ftyp')!;
  const brand = readType(bytes, ftyp.offset + ftyp.headerSize);
  const moov = findBox(walked.boxes, 'moov')!;
  const probe: Mp4Probe = { brand };
  for (const child of childrenOf(bytes, moov)) {
    if (child.type === 'mvhd') {
      const p = child.offset + child.headerSize;
      const version = bytes[p];
      if (version === 1 && child.size >= child.headerSize + 32) {
        const timescale = readU32(bytes, p + 20);
        const duration = readU64(bytes, p + 24);
        if (timescale > 0) probe.durationSeconds = duration / timescale;
      } else if (child.size >= child.headerSize + 20) {
        const timescale = readU32(bytes, p + 12);
        const duration = readU32(bytes, p + 16);
        if (timescale > 0) probe.durationSeconds = duration / timescale;
      }
    }
    if (child.type === 'trak') {
      for (const t of childrenOf(bytes, child)) {
        if (t.type !== 'tkhd') continue;
        const p = t.offset + t.headerSize;
        const version = bytes[p];
        const dimsAt = p + (version === 1 ? 88 : 76);
        if (t.offset + t.size < dimsAt + 8) continue;
        const width = readU32(bytes, dimsAt) / 65536;
        const height = readU32(bytes, dimsAt + 4) / 65536;
        if (width > 0 && height > 0 && width * height > (probe.width ?? 0) * (probe.height ?? 0)) {
          probe.width = Math.round(width);
          probe.height = Math.round(height);
        }
      }
    }
  }
  return probe;
}

/** Box types that only ever carry metadata (location, device, XMP, Windows extras). */
const METADATA_TYPES = new Set(['udta', 'meta', 'uuid', 'xtra']);

function isMetadataBox(bytes: Uint8Array, box: Box): boolean {
  return METADATA_TYPES.has(box.type) || bytes[box.offset + 4] === COPYRIGHT_SIGN;
}

export interface StripResult {
  bytes: Uint8Array;
  strippedBoxes: string[];
}

/**
 * Renames metadata boxes to `free` and zero-fills their payload, at the top level and inside
 * moov/trak. The file keeps its exact size, so sample chunk offsets remain valid and no
 * re-muxing is needed. Returns a copy; the input is never mutated.
 */
export function stripMp4Metadata(input: Uint8Array): StripResult {
  const bytes = new Uint8Array(input);
  const stripped: string[] = [];
  const blank = (box: Box) => {
    stripped.push(bytes[box.offset + 4] === COPYRIGHT_SIGN ? `(c)${box.type.slice(1)}` : box.type);
    bytes.set([0x66, 0x72, 0x65, 0x65], box.offset + 4); // "free"
    bytes.fill(0, box.offset + box.headerSize, box.offset + box.size);
  };
  const visit = (boxes: Box[], depth: number) => {
    for (const box of boxes) {
      if (isMetadataBox(bytes, box)) {
        blank(box);
        continue;
      }
      if (depth < 2 && (box.type === 'moov' || box.type === 'trak')) visit(childrenOf(bytes, box), depth + 1);
    }
  };
  const top = listBoxes(bytes, 0, bytes.byteLength);
  if (top) visit(top, 0);
  return { bytes, strippedBoxes: stripped };
}

/** True when any metadata box survives (used to verify a served video derivative). */
export function mp4HasMetadataBoxes(bytes: Uint8Array): boolean {
  const top = listBoxes(bytes, 0, bytes.byteLength);
  if (!top) return true;
  const check = (boxes: Box[], depth: number): boolean =>
    boxes.some((b) => isMetadataBox(bytes, b) || (depth < 2 && (b.type === 'moov' || b.type === 'trak') && check(childrenOf(bytes, b), depth + 1)));
  return check(top, 0);
}

/* ------------------------------------------------------------------ builders (fixtures/tests) */

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

export function box(type: string | Uint8Array, ...payloads: Uint8Array[]): Uint8Array {
  const body = payloads.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(8 + body);
  out.set(u32(8 + body), 0);
  const t = typeof type === 'string' ? ascii(type) : type;
  out.set(t.subarray(0, 4), 4);
  let at = 8;
  for (const p of payloads) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

export const ascii = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));
export const bytesOf = (...n: number[]): Uint8Array => new Uint8Array(n);
/** The QuickTime "(c)xyz" location atom type. */
export const XYZ_ATOM_TYPE = new Uint8Array([COPYRIGHT_SIGN, 0x78, 0x79, 0x7a]);

/**
 * A structurally valid (not decodable) MP4 for tests: ftyp + moov(mvhd, trak(tkhd), udta((c)xyz))
 * + mdat. `brand` 'qt  ' produces a QuickTime file-type signature.
 */
export function buildSyntheticMp4(opts: { brand?: 'isom' | 'mp42' | 'qt  '; width?: number; height?: number; durationSeconds?: number; location?: string; mdatBytes?: number; trailing?: Uint8Array } = {}): Uint8Array {
  const brand = opts.brand ?? 'isom';
  const compat = brand === 'qt  ' ? 'qt  ' : 'isomiso2avc1mp41';
  const ftyp = box('ftyp', ascii(brand), bytesOf(...u32(0x200)), ascii(compat));
  const timescale = 1000;
  const duration = Math.round((opts.durationSeconds ?? 2) * timescale);
  const mvhd = box('mvhd', bytesOf(0, 0, 0, 0), bytesOf(...u32(0)), bytesOf(...u32(0)), bytesOf(...u32(timescale)), bytesOf(...u32(duration)), new Uint8Array(80));
  const tkhdBody = new Uint8Array(84);
  tkhdBody.set(u32(0), 0); // version/flags
  tkhdBody.set(u32(0), 4); // ctime
  tkhdBody.set(u32(0), 8); // mtime
  tkhdBody.set(u32(1), 12); // track id
  tkhdBody.set(u32(duration), 20);
  tkhdBody.set(u32((opts.width ?? 320) * 65536), 76);
  tkhdBody.set(u32((opts.height ?? 240) * 65536), 80);
  const trak = box('trak', box('tkhd', tkhdBody));
  const parts: Uint8Array[] = [mvhd, trak];
  if (opts.location) {
    const loc = ascii(opts.location);
    parts.push(box('udta', box(XYZ_ATOM_TYPE, bytesOf((loc.byteLength >> 8) & 0xff, loc.byteLength & 0xff, 0x15, 0xc7), loc)));
  }
  const moov = box('moov', ...parts);
  const mdat = box('mdat', new Uint8Array(opts.mdatBytes ?? 64).fill(0x11));
  const chunks = [ftyp, moov, mdat, ...(opts.trailing ? [opts.trailing] : [])];
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
