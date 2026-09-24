#!/usr/bin/env node
/**
 * Records the stage tours (demos/stages.webreel.json): proof, in a browser, that the wedding app
 * serves every stage of the design pipeline where src/lib/stage-hosting.ts says it does.
 *
 *   npm run stages:assemble && npm run build && npm run start      # the app on :3000, as CI job 5
 *   npm run demos:stages                                            # both tours → docs/demos/
 *   npm run demos:stages -- stages-by-path                          # one
 *
 * `stages-by-subdomain` walks dev.kendrick.localhost → sitemap.dev… → wireframe.dev… →
 * skeleton.dev… → placeholder.dev… → kendrick.localhost itself, by clicking each stage bar, then
 * asks the hub host for a page it must not serve. kendrick.localhost is production's shape
 * (kendrick.wedding) on this machine, and the right one for two reasons found the hard way:
 *   - Chromium treats `localhost` as a top-level domain, so kendrick.localhost and every
 *     *.dev.kendrick.localhost are one site. dev.localhost → localhost is not: the renderer swaps
 *     on the hop to the real site and webreel's screenshots stay on the old one.
 *   - *.localhost is a secure context over plain http. Any other name (kendrick.test was tried)
 *     gets its navigations and stylesheets upgraded to https, by Chromium and by the site's own
 *     CSP (`upgrade-insecure-requests`), and nothing answers there.
 * `stages-by-path` walks a preview's /stages → /skeleton/rsvp → … → /rsvp on localhost.
 *
 * webreel launches whatever sits at $HOME/.webreel/bin/chrome-headless-shell. So the tours run
 * with a HOME of their own (demos/.out/home, git-ignored) holding a wrapper around a local
 * Chromium in new headless mode: webreel's --enable-begin-frame-control otherwise stalls every
 * screenshot (docs/ops/demos.md). The ffmpeg webreel downloaded into your own ~/.webreel is
 * linked in. Your ~/.webreel is not touched.
 *
 * Every frame carries the address the browser is on and the HTTP status it got
 * (demos/recorder-preload.cjs), because webreel records the page, not the address bar. Encoding is
 * record.mjs's own (`--encode`): an MP4 and a GIF per tour in docs/demos/. See docs/ops/demos.md.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEMOS = join(ROOT, 'demos');
const HOME = join(DEMOS, '.out/home');
const WEBREEL = 'webreel@0.1.4';
const config = JSON.parse(readFileSync(join(DEMOS, 'stages.webreel.json'), 'utf8'));
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const names = Object.keys(config.videos).filter((n) => wanted.length === 0 || wanted.includes(n));

const res = await fetch('http://localhost:3000/stages').catch(() => null);
if (res?.status !== 200) {
  console.error('record-stages: nothing serves http://localhost:3000/stages. Assemble, build and start the app first (see the header of this file).');
  process.exit(1);
}

/** A Chromium that runs new headless mode: CHROMIUM, or Playwright's, or one on PATH. */
function chromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache/ms-playwright');
  for (const dir of existsSync(pw) ? readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : []) {
    const exe = join(pw, dir, 'chrome-linux/chrome');
    if (existsSync(exe)) return exe;
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    const r = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.trim();
  }
  throw new Error('record-stages: no Chromium found; set CHROMIUM to one.');
}

rmSync(HOME, { recursive: true, force: true });
const shell = join(HOME, '.webreel/bin/chrome-headless-shell/chrome-headless-shell-linux64');
mkdirSync(shell, { recursive: true });
// One renderer for the whole tour, belt and braces: a swap strands webreel's screenshots.
const flags = ['--headless=new', '--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process,ProactivelySwapBrowsingInstance,BackForwardCache,RenderDocument'];
writeFileSync(join(shell, 'chrome-headless-shell'), `#!/bin/sh\nexec '${chromium()}' ${flags.join(' ')} "$@"\n`);
chmodSync(join(shell, 'chrome-headless-shell'), 0o755);
const ffmpeg = join(homedir(), '.webreel/bin/ffmpeg');
if (existsSync(ffmpeg)) symlinkSync(ffmpeg, join(HOME, '.webreel/bin/ffmpeg'));

const env = { ...process.env, HOME };
delete env.NODE_OPTIONS;
const which = spawnSync('npm', ['exec', '--yes', `--package=${WEBREEL}`, '-c', 'command -v webreel'], { encoding: 'utf8', env: { ...env, HOME: homedir() } });
const webreel = process.env.WEBREEL_BIN ?? which.stdout.trim().split('\n').pop();
if (!webreel) throw new Error(`could not install ${WEBREEL}: ${which.stderr}`);

// A tour can still lose its page at a host change now and then (the wait after a stage-bar click
// times out). A take either completes or fails, never half-records, so a failed tour is re-run.
const ATTEMPTS = 3;
for (const name of names) {
  for (let n = 1; ; n++) {
    const r = spawnSync(process.execPath, ['--require', join(DEMOS, 'recorder-preload.cjs'), webreel, 'record', '-c', join(DEMOS, 'stages.webreel.json'), name], { cwd: DEMOS, stdio: 'inherit', env });
    if (r.status === 0) break;
    if (n === ATTEMPTS) throw new Error(`record-stages: ${name} failed ${ATTEMPTS} times; see the step named above.`);
    console.log(`record-stages: ${name} failed (attempt ${n} of ${ATTEMPTS}); recording it again.`);
  }
}
execFileSync(process.execPath, [join(ROOT, 'scripts/demos/record.mjs'), '--encode', ...names], { cwd: ROOT, stdio: 'inherit', env: { ...env, HOME: homedir() } });
