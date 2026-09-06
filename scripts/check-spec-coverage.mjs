#!/usr/bin/env node
/**
 * Every Playwright spec must run in exactly one CI arrangement.
 *
 * There are two, because they need incompatible servers: the production build (`next start`), and a
 * NODE_ENV=test server where the dev inbox and the test-principal injector exist. A spec that
 * belongs to neither list is never executed — which is how `tests/security/**` came to assert a CSRF
 * guarantee the code did not make, unnoticed, while the level-06 PR cited those suites as evidence.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';

/** Runs against `next start`. Asserts production behaviour (cache headers, no dev routes). */
export const PRODUCTION_SPECS = [
  'tests/e2e/content-themes.spec.ts',
  'tests/e2e/explore.spec.ts',
  'tests/e2e/smoke.spec.ts',
  'tests/e2e/themes.spec.ts',
];

/** Needs NODE_ENV=test: the dev inbox (claim) or the test-principal injector (everything else). */
export const TEST_SERVER_SPECS = [
  'tests/e2e/claim.spec.ts',
  'tests/e2e/rsvp.spec.ts',
  'tests/e2e/seating.spec.ts',
  'tests/security/idor.spec.ts',
  'tests/security/invitation.spec.ts',
  'tests/security/otp.spec.ts',
  'tests/security/rsvp.spec.ts',
  'tests/security/seating.spec.ts',
];

function check() {
  const found = ['tests/e2e', 'tests/security']
    .flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.spec.ts')).map((f) => join(dir, f)))
    .sort();

  const claimed = [...PRODUCTION_SPECS, ...TEST_SERVER_SPECS].sort();
  const missing = found.filter((f) => !claimed.includes(f));
  const stale = claimed.filter((f) => !found.includes(f));
  const duplicated = claimed.filter((f, i) => claimed.indexOf(f) !== i);

  if (missing.length || stale.length || duplicated.length) {
    if (missing.length) console.error(`Spec files run by no CI step:\n  ${missing.join('\n  ')}\n  -> add each to PRODUCTION_SPECS or TEST_SERVER_SPECS in ${import.meta.filename ?? 'scripts/check-spec-coverage.mjs'}`);
    if (stale.length) console.error(`Listed but missing from disk:\n  ${stale.join('\n  ')}`);
    if (duplicated.length) console.error(`Listed in both steps:\n  ${duplicated.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`spec coverage ok: ${PRODUCTION_SPECS.length} production + ${TEST_SERVER_SPECS.length} test-server = ${found.length} specs`);
}

// Importing this module (the CI steps read the two lists from it) must not run the check or print
// anything: its stdout is command-substituted into the `playwright test` argument list.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) check();
