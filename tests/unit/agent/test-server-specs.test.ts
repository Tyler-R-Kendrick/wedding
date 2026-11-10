import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATABASE_URL_ALIASES as SERVER_ALIASES } from '@/lib/env';
import { DATABASE_URL_ALIASES, localIsolation, routesToWarm, splitArgs, testServerEnv, WARM_ROUTES, warmUp } from '../../../scripts/test-server-specs.mjs';

/** The CI step as text: from its `- name:` line to the next step (the repository has no YAML parser). */
function ciStep(): string | undefined {
  const text = readFileSync('.github/workflows/design-quality.yml', 'utf8');
  const start = text.indexOf('- name: Identity, RSVP and security specs');
  if (start < 0) return undefined;
  const rest = text.slice(start + 1);
  return rest.slice(0, rest.search(/\n {6}- /) + 1 || undefined);
}

describe('npm run test:e2e:server is the CI test-server step', () => {
  it('is what CI runs, so there is one warm-up list and one set of server settings', () => {
    const step = ciStep();
    expect(step, 'the "Identity, RSVP and security specs" step moved or was renamed').toBeDefined();
    expect(step).toMatch(/^ {8}run: node scripts\/test-server-specs\.mjs$/m);
    // No second copy of the routes or the settings in the workflow.
    expect(step).not.toMatch(/for path in|curl /);
    const env = [...step!.slice(step!.indexOf('\n        env:\n')).matchAll(/^ {10}([A-Z0-9_]+):/gm)].map((m) => m[1]);
    expect(env.sort()).toEqual(['CI', 'PORT']);
  });

  it('needs no swap: nothing in the workflow adds any', () => {
    expect(readFileSync('.github/workflows/design-quality.yml', 'utf8')).not.toMatch(/swapon|mkswap|fallocate/);
  });

  it('gives the server the settings the specs depend on', () => {
    const env = testServerEnv('3000');
    expect(env).toMatchObject({ NODE_ENV: 'test', SEED_TEST_FIXTURES: '1', FLAG_RSVP_MEALS: 'on', FLAG_PHONE_SIGN_IN: 'on', MEDIA_PART_SIZE_MB: '1', MEDIA_MULTIPART_THRESHOLD_MB: '1', PGLITE_MEMORY: '1', DB_AUTO_MIGRATE: '1', DB_AUTO_SEED: '1', TRUSTED_PROXY_HOPS: '1' });
    for (const key of ['BASE_URL', 'NEXT_PUBLIC_SITE_URL', 'BETTER_AUTH_URL'] as const) expect(env[key], key).toBe('http://localhost:3000');
    // The dev inbox bearer and the principal injector's secret reach the server and the runner alike.
    expect(env.DEV_INBOX_TOKEN).toBeTruthy();
    expect(env.TEST_AUTH_SECRET).toBeTruthy();
  });

  it('pauses the warm-up when the server has grown past its headroom, until the memory is released', async () => {
    // Readings in MB, one per look: two routes compile, the third takes the server 3 GB up, the
    // compiler lets go two looks later, and the last route fits.
    const readings = [1000, 1400, 1800, 4200, 4300, 1900, 1900, 1900, 2300];
    let look = 0;
    let pauses = 0;
    const asked: string[] = [];
    const peak = await warmUp(['/a', '/b', '/c', '/d'], async (route: string) => void asked.push(route), {
      memory: () => readings[Math.min(look++, readings.length - 1)]!,
      headroomMb: 2500,
      pause: async () => void pauses++,
    });
    expect(asked).toEqual(['/a', '/b', '/c', '/d']);
    expect(pauses, 'paused once, for as long as the memory took to come down and hold').toBe(4);
    expect(peak).toBe(4300);
  });

  it('does not pause at all while the server stays inside its headroom, or where memory cannot be read', async () => {
    let pauses = 0;
    await warmUp(['/a', '/b'], async () => {}, { memory: () => 1000, pause: async () => void pauses++ });
    await warmUp(['/a', '/b'], async () => {}, { memory: () => null, pause: async () => void pauses++ });
    expect(pauses).toBe(0);
  });

  it('gives up a pause after its limit, so a server that never lets go cannot hang the run', async () => {
    let pauses = 0;
    let grown = false;
    await warmUp(['/a', '/b'], async () => void (grown = true), { memory: () => (grown ? 9000 : 1000), pause: async () => void pauses++, maxPauseMs: 3000, stepMs: 500 });
    expect(pauses).toBe(6);
  });

  it('warms everything for a full run, and for named specs only what they reach', () => {
    expect(routesToWarm([])).toEqual(WARM_ROUTES);
    const spec = "await page.goto('/sign-in?next=%2Frsvp'); await page.goto(\"/admin/rsvp/export\"); await page.goto(`/trip`); const x = '/giftshop';";
    const warm = routesToWarm(['a.spec.ts'], () => spec);
    for (const route of ['/', '/sign-in', '/sign-out', '/admin', '/admin/rsvp/export', '/trip']) expect(warm, route).toContain(route);
    // '/gifts' is a prefix of a different string, not a navigation; the big console pages are not reached.
    for (const route of ['/gifts', '/admin/guests/export', '/admin/media/duplicates']) expect(warm, route).not.toContain(route);
    expect(new Set(warm).size).toBe(warm.length);
  });

  it('takes files, file:line filters and directories as specs, and passes everything else to Playwright', () => {
    const dirs = new Set(['tests/security']);
    const { specs, passThrough } = splitArgs(['tests/e2e/claim.spec.ts:73', 'tests/security', '--project=mobile', '-g', 'admin sign-in', '--headed'], (p) => dirs.has(p));
    expect(specs).toEqual(['tests/e2e/claim.spec.ts:73', 'tests/security']);
    expect(passThrough).toEqual(['--project=mobile', '-g', 'admin sign-in', '--headed']);
  });
});

describe('npm run test:e2e:server never reaches a real system', () => {
  const example = readFileSync('.env.example', 'utf8');
  const blanked = localIsolation(example, testServerEnv('3100'));

  it('blanks the database, its aliases, the mailer, the bucket and the admin list a local .env may hold', () => {
    for (const key of ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'RESEND_CONNECT_USER_ID', 'EMAIL_FROM', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'ADMIN_EMAILS', 'UBER_CLIENT_SECRET', 'DUFFEL_API_KEY']) {
      expect(blanked[key], key).toBe('');
    }
  });

  it("keeps CI's own test values rather than blanking them", () => {
    for (const key of Object.keys(testServerEnv('3100'))) expect(blanked, key).not.toHaveProperty(key);
  });

  it('knows every Postgres alias the server reads', () => {
    expect([...DATABASE_URL_ALIASES].sort()).toEqual([...SERVER_ALIASES].sort());
  });
});
