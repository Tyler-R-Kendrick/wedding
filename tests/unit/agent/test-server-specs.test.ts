import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATABASE_URL_ALIASES as SERVER_ALIASES } from '@/lib/env';
import { DATABASE_URL_ALIASES, localIsolation, splitArgs, testServerEnv } from '../../../scripts/test-server-specs.mjs';

/** The CI step as text: from its `- name:` line to the next step (the repository has no YAML parser). */
function ciStep(): string | undefined {
  const text = readFileSync('.github/workflows/design-quality.yml', 'utf8');
  const start = text.indexOf('- name: Identity, RSVP and security specs');
  if (start < 0) return undefined;
  const rest = text.slice(start + 1);
  return rest.slice(0, rest.search(/\n {6}- /) + 1 || undefined);
}

describe('npm run test:e2e:server is the CI test-server step', () => {
  it('is what CI runs, so there is one set of server settings', () => {
    const step = ciStep();
    expect(step, 'the "Identity, RSVP and security specs" step moved or was renamed').toBeDefined();
    // The script and nothing else: one server for every project, on the build the job already made.
    expect(step).toMatch(/^ {8}run: node scripts\/test-server-specs\.mjs --no-build( --project=\w+)*$/m);
    // No second copy of the routes or the settings in the workflow.
    expect(step).not.toMatch(/for path in|curl /);
    const env = [...step!.slice(step!.indexOf('\n        env:\n')).matchAll(/^ {10}([A-Z0-9_]+):/gm)].map((m) => m[1]);
    expect(env.sort()).toEqual(['CI', 'PORT']);
  });

  it('gives the server the settings the specs depend on', () => {
    const env = testServerEnv('3000');
    expect(env).toMatchObject({ NODE_ENV: 'test', SEED_TEST_FIXTURES: '1', FLAG_RSVP_MEALS: 'on', MEDIA_PART_SIZE_MB: '1', MEDIA_MULTIPART_THRESHOLD_MB: '1', PGLITE_MEMORY: '1', DB_AUTO_MIGRATE: '1', DB_AUTO_SEED: '1', TRUSTED_PROXY_HOPS: '1' });
    for (const key of ['BASE_URL', 'NEXT_PUBLIC_SITE_URL', 'BETTER_AUTH_URL'] as const) expect(env[key], key).toBe('http://localhost:3000');
    // The dev inbox bearer and the principal injector's secret reach the server and the runner alike.
    expect(env.DEV_INBOX_TOKEN).toBeTruthy();
    expect(env.TEST_AUTH_SECRET).toBeTruthy();
  });

  it('serves the production build, and has no warm-up to keep in step with the routes', () => {
    const script = readFileSync('scripts/test-server-specs.mjs', 'utf8');
    expect(script).toContain("['next', 'start', '-p', port]");
    expect(script).not.toMatch(/'next', 'dev'|WARM_ROUTES/);
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
