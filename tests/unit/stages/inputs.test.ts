import { describe, expect, it } from 'vitest';
import { INPUTS, affects } from '../../../scripts/stages/inputs.mjs';

describe('stage inputs: changes cascade down the pipeline, never up', () => {
  const order = ['sitemap', 'wireframe', 'skeleton', 'placeholder'] as const;

  it('a stage reads every stage above it', () => {
    order.forEach((stage, i) => {
      for (const upstream of order.slice(0, i + 1)) {
        const dir = (INPUTS as Record<string, string[]>)[upstream]!.find((p) => p.startsWith('stages/0'))!;
        expect(affects(stage, [`${dir}lib/x.ts`]), `${upstream} → ${stage}`).toBe(true);
      }
    });
  });

  it('a stage never rebuilds for a change below it', () => {
    expect(affects('sitemap', ['stages/02-wireframe/lib/index.ts'])).toBe(false);
    expect(affects('wireframe', ['stages/04-placeholder/lib/placeholder.ts'])).toBe(false);
  });

  it('only the placeholder stage wears the real designs', () => {
    expect(affects('placeholder', ['src/themes/botanical-deco/DESIGN.md'])).toBe(true);
    expect(affects('skeleton', ['src/themes/botanical-deco/DESIGN.md'])).toBe(false);
  });
});
