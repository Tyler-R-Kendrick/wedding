import { describe, expect, it } from 'vitest';
import { allWireframes, walk } from '@wedding/wireframe';
import { BREAKPOINTS, bonesFor } from '../lib/bones';

describe('bones from wireframes', () => {
  it('lay out a paragraph at every capture width, in percentages', () => {
    const r = bonesFor({ kind: 'text', lines: 4 });
    for (const bp of BREAKPOINTS) {
      const at = r.breakpoints[bp]!;
      expect(at.bones).toHaveLength(4);
      for (const b of at.bones as { x: number; w: number }[]) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.w).toBeLessThanOrEqual(100);
      }
      expect((at.bones.at(-1) as { w: number }).w).toBeLessThan(100); // the ragged last line
    }
  });

  it('keep an image slot at its aspect ratio', () => {
    const at = bonesFor({ kind: 'media', aspect: 'wide' }).breakpoints[768]!;
    expect(at.height).toBeCloseTo((768 * 9) / 16, 0);
  });

  it('can be computed for every block of every wireframe', () => {
    let blocks = 0;
    for (const w of allWireframes()) walk(w.blocks, () => blocks++);
    expect(blocks).toBeGreaterThan(100);
    expect(() => bonesFor({ kind: 'line', fraction: 0.5 })).not.toThrow();
  });
});
