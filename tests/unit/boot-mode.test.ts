import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { startsLazily, WARM_PATHS } from '@/lib/boot-mode';
import { SESSION_COOKIES } from '@/themes/routes';

describe('how a server process starts', () => {
  it('production starts lazily; development and test start eagerly', () => {
    expect(startsLazily({ NODE_ENV: 'production' })).toBe(true);
    expect(startsLazily({ NODE_ENV: 'development' })).toBe(false);
    expect(startsLazily({ NODE_ENV: 'test' })).toBe(false);
    expect(startsLazily({})).toBe(false);
  });

  it('production with a boot seed or a test secret takes the eager start, which seeds and refuses the secret', () => {
    expect(startsLazily({ NODE_ENV: 'production', DB_AUTO_SEED: '1' })).toBe(false);
    expect(startsLazily({ NODE_ENV: 'production', TEST_AUTH_SECRET: 'x' })).toBe(false);
  });

  it('the lazy start loads neither the sign-in libraries nor the database before a request needs them', () => {
    const hook = readFileSync('src/instrumentation.ts', 'utf8');
    const lazy = hook.slice(hook.indexOf('if (startsLazily(process.env))'), hook.indexOf('// ORDER MATTERS'));
    expect(lazy).toContain('return;');
    // Imports written outside a function run at start; inside `resolve` and the travel hook they wait.
    const eagerImports = [...lazy.matchAll(/^ {4}const [^\n]*await import\('([^']+)'\)/gm)].map((m) => m[1]);
    expect(eagerImports.sort()).toEqual(['@/lib/logger', '@/lib/principal']);
  });
});

describe('the keep-warm tick', () => {
  it('runs every five minutes with the job runners', () => {
    const { crons } = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string; schedule: string }[] };
    expect(crons).toContainEqual({ path: '/api/warm', schedule: '*/5 * * * *' });
  });

  it('asks for pages, never for anything that changes data, and carries the cookie that selects the signed-in path', () => {
    for (const path of WARM_PATHS) expect(path, path).toMatch(/^\/(?:[a-z-]+(?:\/[a-z-]+)*)?$/);
    expect(WARM_PATHS).toContain('/sign-in');
    expect(WARM_PATHS).toContain('/guests');
    const route = readFileSync('src/app/api/warm/route.ts', 'utf8');
    expect(route).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    expect(new RegExp(`^${SESSION_COOKIES}$`).test('__Secure-wedding.session_token=keep-warm')).toBe(true);
    expect(new RegExp(`^${SESSION_COOKIES}$`).test('wedding.session_token=keep-warm')).toBe(true);
  });
});
