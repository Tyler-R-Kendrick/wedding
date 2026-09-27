import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routesToWarm, testServerEnv, WARM_ROUTES } from '../../../scripts/test-server-specs.mjs';

/**
 * The CI step as text: from its `- name:` line to the next step. The repository has no YAML parser
 * among its dependencies, and the parts read here are flat — `KEY: value` lines under `env:` and
 * one shell `for` loop — so a regex reads them exactly.
 */
function ciStep(): { run: string; env: Record<string, string> } | undefined {
  const text = readFileSync('.github/workflows/design-quality.yml', 'utf8');
  const start = text.indexOf('- name: Identity, RSVP and security specs');
  if (start < 0) return undefined;
  const rest = text.slice(start + 1);
  const step = rest.slice(0, rest.search(/\n {6}- /) + 1 || undefined);
  const envBlock = step.slice(step.indexOf('\n        env:\n'));
  const env: Record<string, string> = {};
  for (const [, key, value] of envBlock.matchAll(/^ {10}([A-Z0-9_]+): *(.*)$/gm)) env[key!] = value!.trim().replace(/^'(.*)'$/, '$1');
  return { run: step.slice(0, step.indexOf('\n        env:\n')), env };
}

const step = ciStep();

describe('npm run test:e2e:server mirrors the CI test-server step', () => {
  it('finds the CI step it mirrors', () => {
    expect(step?.env.NODE_ENV, 'the "Identity, RSVP and security specs" step moved or was renamed').toBe('test');
  });

  it('gives the server every setting CI gives it (CI alone sets CI=true)', () => {
    const ci = Object.keys(step!.env).filter((k) => k !== 'CI').sort();
    expect(Object.keys(testServerEnv('3000')).sort()).toEqual(ci);
    // The values that change behaviour, rather than name a placeholder secret, match exactly.
    for (const key of ['NODE_ENV', 'SEED_TEST_FIXTURES', 'FLAG_RSVP_MEALS', 'MEDIA_PART_SIZE_MB', 'MEDIA_MULTIPART_THRESHOLD_MB', 'PGLITE_MEMORY', 'DB_AUTO_MIGRATE', 'DB_AUTO_SEED', 'TRUSTED_PROXY_HOPS', 'BASE_URL', 'NEXT_PUBLIC_SITE_URL', 'BETTER_AUTH_URL']) {
      expect(testServerEnv('3000')[key as keyof ReturnType<typeof testServerEnv>], key).toBe(step!.env[key]);
    }
  });

  it('warms exactly the routes CI warms', () => {
    const list = /for path in ([\s\S]*?); do/.exec(step!.run)?.[1];
    expect(list, 'the warm-up loop in the CI step moved').toBeDefined();
    const ci = list!.replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean);
    expect([...WARM_ROUTES].sort()).toEqual([...ci].sort());
  });

  it('warms everything for a full run, and for named specs only what they reach', () => {
    expect(routesToWarm([])).toEqual(WARM_ROUTES);
    const spec = "await page.goto('/sign-in?next=%2Frsvp'); await page.goto(\"/admin/rsvp/export\"); await page.goto(`/trip`); const x = '/travelling';";
    const warm = routesToWarm(['a.spec.ts'], () => spec);
    for (const route of ['/', '/sign-in', '/sign-out', '/admin', '/admin/rsvp/export', '/trip']) expect(warm, route).toContain(route);
    // '/travel' is a prefix of a different string, not a navigation; the big console pages are not reached.
    for (const route of ['/travel', '/admin/guests/export', '/admin/media/duplicates']) expect(warm, route).not.toContain(route);
    expect(new Set(warm).size).toBe(warm.length);
  });
});
