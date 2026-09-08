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
  // Level 08: /travel and /trip are public and guest-gated respectively, and the spec only needs an
  // anonymous visitor — it asserts that /trip and /admin/travel turn one away, rather than signing
  // one in. It also reads the flights provider mode from /api/health, so the runner exports
  // HEALTH_TOKEN alongside the server's.
  'tests/e2e/travel.spec.ts',
  // Level 09: the dead-internal-link walk. Anonymous, and it wants the production route table —
  // a dev server compiles on demand, so a missing page is slower to distinguish from a slow one.
  'tests/e2e/links.spec.ts',
  // Level 12: the concierge journey is anonymous end to end — it opens the island on /ask-us and
  // posts to /api/ai/chat as a visitor, so it needs no test principal. It belongs here rather than
  // on the test server because the two things it asserts about are production behaviour: the answer
  // must be grounded and cited against the SEEDED knowledge base, and the chat route must be the
  // only door (405 on GET, 403 on a form-encoded POST). With no ANTHROPIC_API_KEY in CI the model
  // provider is not live, so `conciergeModels()` hands back the deterministic extractive mock.
  'tests/e2e/concierge.spec.ts',
  // Level 15: the CSP and HSTS. It belongs here and nowhere else — the production policy is the
  // strict one (no 'unsafe-eval', no ws:, plus upgrade-insecure-requests and HSTS) and `next dev`
  // serves the relaxed one, so on a dev server the spec would be asserting the wrong policy.
  // Anonymous throughout, and `next start` serves prebuilt routes, so it needs no warm-up.
  'tests/e2e/security-headers.spec.ts',
];

/** Needs NODE_ENV=test: the dev inbox (claim) or the test-principal injector (everything else). */
export const TEST_SERVER_SPECS = [
  'tests/e2e/claim.spec.ts',
  'tests/e2e/rsvp.spec.ts',
  'tests/e2e/seating.spec.ts',
  // Level 08: the signed-in trip page needs the test-principal injector.
  'tests/e2e/trip.spec.ts',
  // Level 09: transport claims and the voucher/redirect suites all drive signed-in principals
  // through identity's test-principal injector, so they need the NODE_ENV=test server.
  'tests/e2e/transport-gifts.spec.ts',
  'tests/security/redirect.spec.ts',
  'tests/security/voucher.spec.ts',
  'tests/security/idor.spec.ts',
  'tests/security/invitation.spec.ts',
  // Level 10: the upload journey and the upload security suite both drive signed-in principals
  // through identity's injector, and the journey needs the dev storage route, so both belong here.
  'tests/e2e/media-upload.spec.ts',
  'tests/security/uploads.spec.ts',
  // Level 11: the media-AI journey uploads as a signed-in guest, drives the cron route with
  // CRON_SECRET, and reads the biometrics opt-in surface — all of which need the NODE_ENV=test
  // server and identity's test-principal injector.
  'tests/e2e/media-ai.spec.ts',
  // Level 13: the WebMCP bridge. It drives signed-in guest and admin principals through the
  // canonical test-principal injector and reads the manifest as each, so it needs the NODE_ENV=test
  // server. Swarm K guarded its authenticated cases on `test.skip(!TEST_AUTH_SECRET)`; those guards
  // are gone, because a spec that skips itself when an env var is missing is exactly how three
  // security suites reported green at level 06. Registered here, the secret is always set.
  'tests/e2e/webmcp.spec.ts',
  // Level 14: the admin console. Signed-in admins come from the canonical test-principal injector,
  // so it needs the NODE_ENV=test server. It is deliberately read-only — every mutation these
  // screens offer changes state other specs on this same server depend on (the RSVP window follows
  // the lifecycle; the media-AI journey expects its own jobs to still be queued), and those paths
  // are covered through the real pipeline in tests/integration/ops-*.test.ts instead.
  'tests/e2e/admin-console.spec.ts',
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
