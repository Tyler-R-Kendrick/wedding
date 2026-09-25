#!/usr/bin/env node
/**
 * impeccable's rendered scan over the running site: every public and guest route, in every design,
 * at a phone, a tablet and two desktop widths.
 *
 *   BASE_URL=http://localhost:3000 npm run slop:detect:rendered
 *   npm run slop:detect:rendered -- --viewports 390x844 --themes conservatory /gifts /travel
 *
 * The source scan (`npm run slop:detect`, `check-design-drift.mjs`) reads CSS and JSX; it cannot
 * see a layout. The rendered scan can, and on 2026-09-23 it was the only check that found three
 * real bugs with everything else green: a nowrap provenance badge that pushed /share-an-adventure
 * off a 390px screen, an ivory script line reading 2.6:1 on the weekend photograph, and 89-102
 * character lines in three designs. (impeccable itself says so: "Next.js project detected … scan via
 * URL for best results".)
 *
 * Guest routes render a sign-in gate to an anonymous browser, and a gate is not the page. With
 * TEST_AUTH_SECRET set (a NODE_ENV=test server started with SEED_TEST_FIXTURES=1, the way the e2e
 * suite runs), the scan goes through a loopback proxy that adds the fixture household's principal
 * headers, the same ones `tests/e2e/helpers/principal.ts` sends. Without it, guest routes are
 * skipped and the output says so.
 *
 * Browser: IMPECCABLE_BROWSER if set, else Playwright's Chromium. As root, Chromium refuses to start
 * without --no-sandbox, so a wrapper adds it. Findings honour `.impeccable/config.json`
 * (URL-scoped `ignoreValues` included). Exit 1 on any anti-pattern or off-scale value.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_IDS } from '../src/themes/registry.ts';
import { principalHeaders } from '../tests/e2e/helpers/principal.ts';
import { classify, format } from './check-design-drift.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The same lists the 17px-floor walk uses (tests/e2e/typography.spec.ts). */
const PUBLIC_ROUTES = ['/', '/our-story', '/our-adventures', '/our-venue', '/the-wedding', '/travel', '/gifts', '/ask-us', '/photos', '/share-an-adventure', '/sign-in'];
const GUEST_ROUTES = ['/rsvp', '/rsvp/attending', '/rsvp/meals', '/your-weekend', '/trip', '/transportation'];
const VIEWPORTS = ['390x844', '820x1180', '1280x800', '1440x900'];

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const [value] = argv.splice(i, 2).slice(1);
  return value.split(',');
};
const viewports = opt('viewports', VIEWPORTS);
const themes = opt('themes', [...THEME_IDS]);
const base = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const secret = process.env.TEST_AUTH_SECRET;
const routes = argv.length ? argv : [...PUBLIC_ROUTES, ...(secret ? GUEST_ROUTES : [])];
if (!secret && !argv.length) console.log(`note: TEST_AUTH_SECRET is unset, so the ${GUEST_ROUTES.length} guest routes are skipped (they would render the sign-in gate).`);

function browser() {
  if (process.env.IMPECCABLE_BROWSER) return process.env.IMPECCABLE_BROWSER;
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), '.cache', 'ms-playwright');
  const found = existsSync(dir)
    ? readdirSync(dir)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort()
        .reverse()
        .map((d) => ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe'].map((f) => path.join(dir, d, f)).find(existsSync))
        .find(Boolean)
    : undefined;
  if (!found) return undefined;
  if (process.getuid?.() !== 0) return found;
  const wrapper = path.join(mkdtempSync(path.join(os.tmpdir(), 'impeccable-chrome-')), 'chrome');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${found}" --no-sandbox "$@"\n`);
  chmodSync(wrapper, 0o755);
  return wrapper;
}

/** Loopback proxy that signs every request in as the fixture household (NODE_ENV=test servers only). */
function guestProxy() {
  const target = new URL(base);
  const headers = principalHeaders('A1', secret);
  const server = http.createServer((req, res) => {
    const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, ...headers, host: target.host } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', (e) => {
      res.writeHead(502);
      res.end(String(e));
    });
    req.pipe(up);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

function run(cmd, args, options) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => resolve({ status: null, stdout, stderr: String(e) }));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const exe = browser();
if (!exe) {
  console.error('rendered scan: no Chromium found. Set IMPECCABLE_BROWSER, or run `npx playwright install chromium`.');
  process.exit(1);
}
const proxy = secret ? await guestProxy() : null;
const origin = proxy?.origin ?? base;
const urls = themes.flatMap((t) => routes.map((r) => `${origin}${r}${r.includes('?') ? '&' : '?'}theme=${t}`));

// A dev server compiles each route on first request; warm them so a cold compile is not a finding.
for (const u of urls) await fetch(u).then((r) => r.arrayBuffer(), () => {});

const cli = path.join(ROOT, 'node_modules', 'impeccable', 'cli', 'bin', 'cli.js');
let failed = 0;
for (const vp of viewports) {
  // Async, not spawnSync: the guest proxy lives in this process, and a blocked event loop would
  // leave every request the detector makes through it unanswered.
  const r = await run(process.execPath, [cli, 'detect', '--json', '--viewport', vp, ...urls], {
    cwd: ROOT,
    env: { ...process.env, IMPECCABLE_BROWSER: exe, NO_PROXY: [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',') },
  });
  let findings;
  try {
    findings = JSON.parse(r.stdout || '[]');
  } catch {
    console.error(`${vp}: the detector did not return a report (exit ${r.status}): ${(r.stderr || '').trim().split('\n').at(-1)}`);
    failed++;
    continue;
  }
  const { primary, drift, notes } = classify(findings);
  const bad = [...primary, ...drift];
  console.log(`${vp.padEnd(9)} ${urls.length} pages: ${bad.length ? `${bad.length} finding(s)` : 'clean'}${notes.length ? ` (${notes.length} copy note(s))` : ''}`);
  for (const f of bad) console.log(`  ${format({ ...f, file: String(f.file).replace(origin, '') })}`);
  failed += bad.length;
}
proxy?.server.close();
process.exit(failed ? 1 : 0);
