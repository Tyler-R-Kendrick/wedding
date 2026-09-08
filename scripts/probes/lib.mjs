/**
 * Shared harness for the design probes in this directory.
 *
 * These are measurement tools, not tests: a test says pass or fail, and a design review needs a
 * NUMBER — 82 characters a line, 15px of label drift, 122 elements under the floor — that can be
 * taken again after the change and compared. Every before/after figure in
 * `docs/reviews/PR-20-self-review.md` came from one of these, and the command is named beside it.
 *
 * Usage: start a server (see the file header of each probe for which one), then
 *   node scripts/probes/<probe>.mjs [args]
 * `PROBE_BASE` overrides the origin (default http://localhost:3316).
 */
import { chromium } from '@playwright/test';

export const BASE = process.env.PROBE_BASE ?? 'http://localhost:3316';
const EXECUTABLE = process.env.PW_CHROMIUM_PATH ?? undefined;
const SECRET = process.env.TEST_AUTH_SECRET ?? 'e2e-test-secret-0123456789';

/** Same derivation as src/db/seed/ids.ts, without importing TypeScript into a plain script. */
const CROCKFORD = /[^0-9A-HJKMNP-TV-Z]/g;
const det = (prefix, tag) => (prefix + tag.toUpperCase().replace(CROCKFORD, '')).slice(0, 26).padEnd(26, '0');
export const fixtureId = (tag) => det('01E2E', tag);

/** The two principals the probes need. Only meaningful against a NODE_ENV=test server. */
export const PRINCIPALS = {
  A1: { kind: 'guest', guestId: fixtureId('GSTA1'), householdId: fixtureId('HHA'), actsFor: [fixtureId('GSTA1'), fixtureId('GSTA2'), fixtureId('GSTA3')] },
  admin: { kind: 'admin', adminId: fixtureId('ADMIN1') },
};

export async function withPage(fn, { viewport = { width: 390, height: 844 }, principal = null, theme = null } = {}) {
  const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}), args: ['--no-sandbox'] });
  const headers = {};
  if (principal) {
    headers['x-test-auth'] = SECRET;
    headers['x-test-principal'] = JSON.stringify(principal);
  }
  const ctx = await browser.newContext({ viewport, extraHTTPHeaders: headers, deviceScaleFactor: 1 });
  if (theme) await ctx.addCookies([{ name: 'theme', value: theme, url: BASE }]);
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/** `node probe.mjs <theme|-> <principal|none> <route...>` — the shape most probes here take. */
export function argv() {
  const [theme, who, ...paths] = process.argv.slice(2);
  return {
    theme: theme === '-' || theme === '' ? null : theme,
    principal: who === 'none' || !who ? null : PRINCIPALS[who],
    paths,
    viewportWidth: Number(process.env.VW ?? 390),
  };
}
