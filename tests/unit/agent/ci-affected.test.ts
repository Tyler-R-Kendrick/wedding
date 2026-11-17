import { describe, expect, it } from 'vitest';
import { affected } from '../../../scripts/ci/affected.mjs';

/**
 * Selection on a pull request (scripts/ci/affected.mjs) may skip a suite only when no changed file
 * can reach it. Each case here hides a real change the way a careless rule would, and requires the
 * suite to run anyway.
 */
describe('a pull request runs every suite its changes can reach', () => {
  const both = (files: string[]) => [affected('integration', files), affected('e2e', files)];

  it.each([
    ['a migration, read from disk at boot and imported by nothing', 'src/db/migrations/0031_example.sql'],
    ['seed content, loaded as JSON', 'src/content/seed/faq.json'],
    ['a stylesheet, which no test imports and every page renders', 'src/app/globals.css'],
    ['a page component', 'src/app/(auth)/sign-in/page.tsx'],
    ['the lockfile', 'bun.lock'],
    ['the package manifest', 'package.json'],
    ['the build configuration', 'next.config.ts'],
    ['a workflow, which decides what runs at all', '.github/workflows/design-quality.yml'],
    ['the shared setup action', '.github/actions/setup/action.yml'],
    ['a public asset the pages serve', 'public/media/botanical-deco/manifest.json'],
    ['a design stage the app serves', 'stages/01-sitemap/lib/sitemap.ts'],
    ['a script the suites start servers with', 'scripts/lib/server-env.mjs'],
    ['a file in a place this rule has never heard of', 'somewhere/new/thing.bin'],
    ['a dotfile at the root', '.nvmrc'],
    ['PRODUCT.md, whose route table links.spec.ts reads', 'PRODUCT.md'],
  ])('%s runs the integration and browser suites', (_what, file) => {
    expect(both([file])).toEqual([true, true]);
    // Hidden among changes that would be skipped on their own, it still runs them.
    expect(both(['docs/ops/local-dev.md', 'tests/unit/env.test.ts', file, 'README.md'])).toEqual([true, true]);
  });

  it('runs everything when the list of changes is empty or missing: no list is no evidence', () => {
    expect(both([])).toEqual([true, true]);
    expect(both(['', '  '])).toEqual([true, true]);
  });

  it('skips both suites for documentation, agent files and unit tests, which neither suite reads', () => {
    expect(both(['docs/ops/observability.md', 'CLAUDE.md', 'tests/unit/crypto.test.ts', 'tests/ui/code-cells.test.tsx', '.claude/skills/impeccable/SKILL.md'])).toEqual([false, false]);
  });

  it('a browser spec runs the browser suite and not the integration one, and the reverse', () => {
    expect(both(['tests/e2e/rsvp.spec.ts', 'playwright.config.ts'])).toEqual([false, true]);
    expect(both(['tests/security/otp.spec.ts'])).toEqual([false, true]);
    expect(both(['tests/integration/rsvp.test.ts'])).toEqual([true, false]);
    // The harness both kinds of browser run go through is the browser suite's.
    expect(both(['scripts/test-server-specs.mjs'])).toEqual([false, true]);
  });

  it('a markdown file is inert only at the root or under docs/: one inside src/ is content', () => {
    expect(both(['src/themes/botanical-deco/DESIGN.md'])).toEqual([true, true]);
  });
});
