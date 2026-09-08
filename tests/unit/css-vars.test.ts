import { describe, expect, it } from 'vitest';
// Plain .mjs script: it is the gate, not a library, and TypeScript infers its shape from the source.
import { check } from '../../scripts/check-css-vars.mjs';

/**
 * The `var()`-shaped hole level 14 found by looking at a screenshot.
 *
 * `ops.css` referenced `var(--font-sans)` and `var(--font-display)`, neither defined anywhere in
 * `src/`. An undefined custom property is invalid at computed-value time, so the whole admin
 * console rendered in Tailwind's default stack — Roboto, Helvetica Neue, Arial — while stylelint,
 * `design:lint`, `slop:detect` and axe all stayed green, because none of them compares a reference
 * against a definition.
 *
 * The check runs here as well as from the CLI so it is inside `npm run test:unit`, which both
 * `npm run verify` and CI's verify job call. A gate that only exists as an npm script the CI
 * workflow does not run is the same failure as a Playwright spec belonging to no arrangement.
 */
describe('every var(--token) resolves', () => {
  it('finds no reference that is undefined and has no fallback', async () => {
    const { missing, referenced, defined } = await check();
    const detail = missing.map((m: { file: string; line: number; token: string }) => `${m.file}:${m.line} var(${m.token})`).join('\n');
    expect(missing, detail).toEqual([]);
    // Sanity: the walk found the tree. A checker that silently scanned nothing would also pass.
    expect(defined).toBeGreaterThan(100);
    expect(referenced).toBeGreaterThan(500);
  });
});
