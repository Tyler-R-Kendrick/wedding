import { describe, expect, it } from 'vitest';
import { csvCell, parseCsv, parseGuestCsv, toCsv } from '@/domain/guests/csv';
import { byteCapacity, chooseVersion, encodeQr, qrSvg } from '@/domain/identity/qr';

describe('csv', () => {
  it('parses quoted fields, escaped quotes, CRLF and BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(toCsv([['a', 'b,c'], ['=SUM(1)', 'q"q']])).toBe('a,"b,c"\r\n\'=SUM(1),"q""q"\r\n');
    expect(csvCell(null)).toBe('');
  });
  it('parses the guest column contract and reports row issues by line', () => {
    const { records, issues } = parseGuestCsv('Household,First Name,last_name,email,kind,manager,event_keys\nThe Smiths,Ann,Smith,ANN@X.CO,adult,yes,ceremony;reception\nThe Smiths,Kid,Smith,,child,,\n,Nobody,,,,,\nThe Smiths,Bad,,not-an-email,,,\n');
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ household: 'The Smiths', firstName: 'Ann', email: 'ann@x.co', kind: 'adult', manager: true, eventKeys: ['ceremony', 'reception'], line: 2 });
    expect(records[1]).toMatchObject({ kind: 'child', isMinor: true, email: null });
    expect(issues.map((i) => i.line)).toEqual([4, 5]);
    expect(parseGuestCsv('first_name\nA').issues[0]!.message).toContain('household');
  });
});

/** Reads the byte-mode payload back out of a matrix (unmask, walk placement) — no EC needed for an undamaged code. */
function readbackText(size: number, version: number, mask: number, modules: boolean[][]): string {
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < size && y < size) isFunction[y]![x] = true; };
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
  const align: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  const a = align[version]!;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === a.length - 1) || (i === a.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(a[i]! + dx, a[j]! + dy);
  }
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(size - 1 - i, 8); mark(8, size - 1 - i); }
  if (version >= 7) for (let i = 0; i < 18; i++) { mark(size - 11 + (i % 3), Math.floor(i / 3)); mark(Math.floor(i / 3), size - 11 + (i % 3)); }
  const maskFn = (m: number, x: number, y: number) => [ (x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0 ][m]!;
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!isFunction[y]![x]) bits.push((modules[y]![x] ? 1 : 0) ^ (maskFn(mask, x, y) ? 1 : 0));
    }
  }
  // De-interleave the data codewords (blocks per version at level M), then parse the byte-mode stream.
  const groups: Record<number, [number, number][]> = { 1: [[1, 16]], 2: [[1, 28]], 3: [[1, 44]], 4: [[2, 32]], 5: [[2, 43]], 6: [[4, 27]], 7: [[4, 31]], 8: [[2, 38], [2, 39]], 9: [[3, 36], [2, 37]], 10: [[4, 43], [1, 44]] };
  const lengths = groups[version]!.flatMap(([count, len]) => Array<number>(count).fill(len));
  const totalData = lengths.reduce((a, b) => a + b, 0);
  const interleaved: number[] = [];
  for (let i = 0; i < totalData; i++) { let v = 0; for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b]!; interleaved.push(v); }
  const blocks: number[][] = lengths.map(() => []);
  let cursor = 0;
  for (let i = 0; i < Math.max(...lengths); i++) for (let b = 0; b < blocks.length; b++) if (i < lengths[b]!) blocks[b]!.push(interleaved[cursor++]!);
  const stream = blocks.flat();
  let bitPos = 0;
  const take = (n: number) => { let v = 0; for (let i = 0; i < n; i++, bitPos++) v = (v << 1) | ((stream[bitPos >> 3]! >> (7 - (bitPos & 7))) & 1); return v; };
  expect(take(4)).toBe(0b0100);
  const len = take(version <= 9 ? 8 : 16);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = take(8);
  return new TextDecoder().decode(bytes);
}

describe('qr encoder', () => {
  it('picks versions by capacity and refuses oversize payloads', () => {
    expect(byteCapacity(1)).toBe(14);
    expect(byteCapacity(10)).toBe(213);
    expect(chooseVersion(14)).toBe(1);
    expect(chooseVersion(15)).toBe(2);
    expect(chooseVersion(80)).toBe(5);
    expect(() => chooseVersion(214)).toThrow(/too long/);
  });

  it('produces a well-formed symbol whose data region reads back to the input', () => {
    for (const text of ['HELLO', 'https://sara-tyler.example/invite/' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v', 'x'.repeat(150)]) {
      const q = encodeQr(text);
      expect(q.size).toBe(q.version * 4 + 17);
      expect(q.modules[0]!.slice(0, 7)).toEqual([true, true, true, true, true, true, true]);
      expect(q.modules[q.size - 8]![8]).toBe(true); // dark module (row 4V+9, col 8)
      expect(readbackText(q.size, q.version, q.mask, q.modules)).toBe(text);
    }
  });

  it('renders an SVG that uses currentColor and no raw colors', () => {
    const svg = qrSvg('https://example.test/invite/abc', { title: 'Invite <QR>' });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('<title>Invite &lt;QR&gt;</title>');
    expect(svg).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
