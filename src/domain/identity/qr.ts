/**
 * Minimal QR Code encoder (ISO/IEC 18004): byte mode, error-correction level M, versions 1–10
 * (up to 213 bytes — enough for an invitation URL). No dependencies, deterministic output.
 * Structure follows the reference algorithm (Nayuki's public-domain description).
 */

export const QR_EC_LEVEL = 'M';

/** Per version at level M: EC codewords per block and [blockCount, dataCodewordsPerBlock] groups. */
const EC_TABLE: Record<number, { ec: number; groups: [number, number][] }> = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: { ec: 22, groups: [[2, 38], [2, 39]] },
  9: { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
};
const ALIGNMENT: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
export const MAX_QR_VERSION = 10;

const dataCodewords = (v: number) => EC_TABLE[v]!.groups.reduce((n, [count, data]) => n + count * data, 0);
const countBits = (v: number) => (v <= 9 ? 8 : 16);
/** Byte-mode capacity per version at level M. */
export const byteCapacity = (v: number): number => Math.floor((dataCodewords(v) * 8 - 4 - countBits(v)) / 8);

// ---- GF(256) with the QR primitive polynomial 0x11D
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();
const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGenerator(degree);
  const out = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ out[0]!;
    out.copyWithin(0, 1);
    out[degree - 1] = 0;
    for (let i = 0; i < degree; i++) out[i] = out[i]! ^ gfMul(gen[i + 1]!, factor);
  }
  return out;
}

class BitBuffer {
  bits: number[] = [];
  push(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

export function chooseVersion(byteLength: number): number {
  for (let v = 1; v <= MAX_QR_VERSION; v++) if (byteCapacity(v) >= byteLength) return v;
  throw new Error(`QR payload too long (${byteLength} bytes; max ${byteCapacity(MAX_QR_VERSION)})`);
}

function buildCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const total = dataCodewords(version);
  const bb = new BitBuffer();
  bb.push(0b0100, 4);
  bb.push(bytes.length, countBits(version));
  for (const b of bytes) bb.push(b, 8);
  bb.push(0, Math.min(4, total * 8 - bb.bits.length));
  while (bb.bits.length % 8 !== 0) bb.bits.push(0);
  for (let pad = 0xec; bb.bits.length < total * 8; pad ^= 0xec ^ 0x11) bb.push(pad, 8);
  const data = new Uint8Array(total);
  for (let i = 0; i < bb.bits.length; i++) data[i >>> 3] = (data[i >>> 3]! << 1) | bb.bits[i]!;

  const { ec, groups } = EC_TABLE[version]!;
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];
  let offset = 0;
  for (const [count, len] of groups) {
    for (let i = 0; i < count; i++) {
      const slice = data.slice(offset, offset + len);
      offset += len;
      blocks.push({ data: slice, ec: rsEncode(slice, ec) });
    }
  }
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]!);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.ec[i]!);
  return Uint8Array.from(out);
}

export interface QrMatrix {
  version: number;
  size: number;
  mask: number;
  modules: boolean[][];
}

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    isFunction[y]![x] = true;
  };

  // Timing patterns
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Finder patterns (+ separators)
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  // Alignment patterns
  const align = ALIGNMENT[version]!;
  for (let i = 0; i < align.length; i++)
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
      const cx = align[i]!;
      const cy = align[j]!;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  // Reserve format areas
  const drawFormat = (mask: number) => {
    const data = (0b00 << 3) | mask; // level M = 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, getBit(bits, i));
    set(8, 7, getBit(bits, 6));
    set(8, 8, getBit(bits, 7));
    set(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(bits, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  // Version info (7+)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // Data placement
  const codewords = buildCodewords(bytes, version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y]![x] && i < codewords.length * 8) {
          modules[y]![x] = getBit(codewords[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
    }
  }

  // Mask selection
  const maskFn = (m: number, x: number, y: number): boolean => {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFunction[y]![x] && maskFn(m, x, y)) modules[y]![x] = !modules[y]![x];
  };
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const score = penalty(modules, size);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
    applyMask(m);
  }
  applyMask(best);
  drawFormat(best);
  return { version, size, mask: best, modules };
}

function penalty(modules: boolean[][], size: number): number {
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 0;
    let prev: boolean | null = null;
    const seq: boolean[] = [];
    for (let i = 0; i < size; i++) {
      const v = get(i);
      seq.push(v);
      if (v === prev) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        prev = v;
        run = 1;
      }
    }
    for (let i = 0; i + 7 <= size; i++) {
      const p = seq.slice(i, i + 7);
      if (p[0] && !p[1] && p[2] && p[3] && p[4] && !p[5] && p[6]) {
        const before = i >= 4 && !seq[i - 1] && !seq[i - 2] && !seq[i - 3] && !seq[i - 4];
        const after = i + 11 <= size && !seq[i + 7] && !seq[i + 8] && !seq[i + 9] && !seq[i + 10];
        if (before || after) score += 40;
      }
    }
  };
  for (let y = 0; y < size; y++) line((x) => modules[y]![x]!);
  for (let x = 0; x < size; x++) line((y) => modules[y]![x]!);
  for (let y = 0; y + 1 < size; y++)
    for (let x = 0; x + 1 < size; x++) {
      const c = modules[y]![x];
      if (c === modules[y]![x + 1] && c === modules[y + 1]![x] && c === modules[y + 1]![x + 1]) score += 3;
    }
  let dark = 0;
  for (const row of modules) for (const m of row) if (m) dark++;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/** SVG string; modules use `currentColor` so the page tints it with tokens, quiet zone via `margin`. */
export function qrSvg(text: string, opts: { margin?: number; title?: string } = {}): string {
  const { size, modules } = encodeQr(text);
  const margin = opts.margin ?? 4;
  const dim = size + margin * 2;
  let d = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y]![x]) d += `M${x + margin} ${y + margin}h1v1h-1z`;
  const title = opts.title ? `<title>${opts.title.replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' })[c]!)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img">${title}<path d="${d}" fill="currentColor"/></svg>`;
}
