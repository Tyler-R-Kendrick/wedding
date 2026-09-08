import { describe, expect, it } from 'vitest';
import { findLeaks } from '../../scripts/check-theme-tokens.mjs';

/**
 * The gate for the token-leak class the level-16 design review found.
 *
 * It is a UNIT test and not a browser one on purpose. In a browser the tell is that two designs
 * compute the same value for a control each design sizes differently — which is invisible wherever
 * the two scales happen to agree (both designs' `body-sm` is 1.0625rem, so a `.badge` reading the
 * unscoped `--text-body-md` and a `.badge` reading the per-design `--type-body-sm-size` measure the
 * same in both). A leak that is only sometimes observable is a leak that comes back.
 *
 * Measured against the code this replaces: 21 leaks across `components/rsvp/recipes.css` and
 * `components/floorplan/floorplan.css`. The review found two of them by measuring two elements.
 */
describe('shared components read per-design tokens', () => {
  it('no shared component reads an unscoped --text-* / --font-weight-* / --tracking-* token', () => {
    const leaks = findLeaks(new URL('../..', import.meta.url).pathname);
    expect(
      leaks.map((l) => `${l.file}:${l.line} ${l.token}`),
      'these resolve to the DEFAULT design’s numbers under BOTH designs, because globals.css imports\n' +
        'that design’s Tailwind @theme block unscoped. Use --type-<style>-<prop>, or put the unscoped\n' +
        'name second: var(--type-body-sm-size, var(--text-body-sm, 1rem)).',
    ).toEqual([]);
  });
});
