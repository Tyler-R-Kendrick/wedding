#!/usr/bin/env node
/**
 * Records the site's demo videos into `docs/demos/`, where the README, the docs and pull requests
 * embed them.
 *
 * Two recorders, each doing the job it is built for:
 *
 * - **webreel** (Vercel) plays the scripted tours in `demos/webreel.config.json` against a
 *   PRODUCTION server — Home, Our Story, Explore and the phone view. It draws the cursor and the
 *   keystrokes, so a viewer can see what was pressed. Production, because a dev server paints its
 *   own badge into the corner of every frame.
 * - **agent-browser** (Vercel) drives the guest journey — Your Weekend and the RSVP form inside it —
 *   against the `NODE_ENV=test` server, because that page is personal and the test server is the
 *   only place a fixture guest can be signed in by header. It records the tab as WebM.
 *
 * Then ffmpeg (webreel's own copy when it has one) turns every raw take into an H.264 MP4 and a GIF.
 * GIFs are what GitHub plays inline in a README or a PR; the MP4s are the sharp versions.
 *
 * Neither tool is a dependency of the site: they are fetched at a pinned version by `npm exec`, so
 * `npm ci` in CI and on Vercel never downloads a browser recorder it will not use.
 *
 *   npm run demos:record                 # everything (needs both servers; see docs/ops/demos.md)
 *   npm run demos:record -- home phone   # just these
 *   npm run demos:record -- --encode     # re-encode existing takes only
 *
 * Environment: DEMO_BASE_URL (production server, default http://localhost:3330), DEMO_GUEST_URL
 * (test server, default http://localhost:3331), TEST_AUTH_SECRET (the test server's; defaults to
 * CI's placeholder), FFMPEG, WEBREEL_BIN, AGENT_BROWSER_BIN, AGENT_BROWSER_EXECUTABLE_PATH.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEMOS = join(ROOT, 'demos');
const RAW = join(DEMOS, '.out');
const OUT = join(ROOT, 'docs/demos');
const WEBREEL = 'webreel@0.1.4';
const AGENT_BROWSER = 'agent-browser@0.27.0';

const BASE = (process.env.DEMO_BASE_URL ?? 'http://localhost:3330').replace(/\/$/, '');
const GUEST = (process.env.DEMO_GUEST_URL ?? 'http://localhost:3331').replace(/\/$/, '');
// The test server's principal injector. This is CI's placeholder value, not a credential: the
// injector refuses to exist outside NODE_ENV=test.
const TEST_AUTH = process.env.TEST_AUTH_SECRET || 'ci-only-test-auth-secret-not-real';
const FIXTURE_GUEST = { kind: 'guest', guestId: '01E2EGSTB10000000000000000', householdId: '01E2EHHB000000000000000000', actsFor: ['01E2EGSTB10000000000000000', '01E2EGSTB20000000000000000'] };
const FIXTURE_ADMIN = { kind: 'admin', adminId: '01E2EADMN10000000000000000' };

const args = process.argv.slice(2);
const encodeOnly = args.includes('--encode');
const wanted = args.filter((a) => !a.startsWith('--'));
const tours = Object.keys(JSON.parse(readFileSync(join(DEMOS, 'webreel.config.json'), 'utf8')).videos);
const want = (name) => wanted.length === 0 || wanted.includes(name);

/** A pinned CLI's executable, installed into npm's cache on first use. */
function bin(spec, name, override) {
  if (override) return override;
  const r = spawnSync('npm', ['exec', '--yes', `--package=${spec}`, '-c', `command -v ${name}`], { encoding: 'utf8' });
  const path = r.stdout.trim().split('\n').pop();
  if (r.status !== 0 || !path) throw new Error(`could not install ${spec}: ${r.stderr}`);
  return path;
}

function ffmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const webreel = join(homedir(), '.webreel/bin/ffmpeg');
  if (existsSync(webreel)) {
    for (const d of readdirSync(webreel)) {
      const p = join(webreel, d, 'bin/ffmpeg');
      if (existsSync(p)) return p;
    }
  }
  return 'ffmpeg';
}

async function up(url, what) {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.status < 500) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`${what} is not answering at ${url} — see docs/ops/demos.md`);
}

async function recordTours() {
  const names = tours.filter(want);
  if (names.length === 0) return;
  await up(BASE, 'the production server');
  const config = JSON.parse(readFileSync(join(DEMOS, 'webreel.config.json'), 'utf8'));
  config.baseUrl = BASE;
  const local = join(DEMOS, '.webreel.local.json');
  writeFileSync(local, JSON.stringify(config, null, 2));
  execFileSync(bin(WEBREEL, 'webreel', process.env.WEBREEL_BIN), ['record', '-c', local, ...names], { cwd: DEMOS, stdio: 'inherit' });
}

async function recordGuest() {
  if (!want('your-weekend')) return;
  await up(GUEST, 'the test server');
  // The inline RSVP form only renders while the window is open; the fixture admin opens it.
  const key = `DEMO${Date.now().toString(36).toUpperCase()}`.padEnd(26, '0').slice(0, 26);
  const res = await fetch(`${GUEST}/api/capabilities/admin_set_rsvp_window`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: GUEST, 'x-test-auth': TEST_AUTH, 'x-test-principal': JSON.stringify(FIXTURE_ADMIN) },
    body: JSON.stringify({ input: { mode: 'open', deadlineAt: null }, idempotencyKey: key }),
  });
  if (!res.ok) throw new Error(`could not open the RSVP window on the test server: ${res.status}`);

  const ab = bin(AGENT_BROWSER, 'agent-browser', process.env.AGENT_BROWSER_BIN);
  // Every call must see the same browser settings, or the daemon relaunches and the page is lost.
  // agent-browser encodes its WebM with whatever ffmpeg is on PATH.
  const ff = ffmpeg();
  const env = { ...process.env, PATH: ff.includes('/') ? `${dirname(ff)}:${process.env.PATH}` : process.env.PATH };
  const session = `demo-${process.pid}`;
  const run = (...a) => execFileSync(ab, ['--session', session, ...a], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'inherit'] });
  const headers = JSON.stringify({ 'x-test-auth': TEST_AUTH, 'x-test-principal': JSON.stringify(FIXTURE_GUEST) });
  const { viewport, steps } = JSON.parse(readFileSync(join(DEMOS, 'your-weekend.steps.json'), 'utf8'));
  const take = join(RAW, 'your-weekend.webm');
  const dry = args.includes('--dry');
  rmSync(take, { force: true });
  try {
    run('open', 'about:blank');
    run('set', 'viewport', String(viewport[0]), String(viewport[1]));
    // `record start` opens a fresh browser context, so the fixture headers are set inside it, and
    // the dev badge is hidden by a style evaluated once the page is up: init scripts registered
    // with --init-script do not follow into that context.
    const started = Date.now();
    if (!dry) run('record', 'start', take);
    run('set', 'headers', headers);
    run('open', `${GUEST}/your-weekend`);
    run('wait', '--load', 'networkidle');
    run('eval', readFileSync(join(DEMOS, 'hide-dev-overlay.js'), 'utf8'));
    run('wait', '400');
    // Everything before this moment is a blank tab and a page loading; the encoder cuts it.
    writeFileSync(join(RAW, 'your-weekend.trim'), String((Date.now() - started) / 1000));
    let n = 0;
    for (const step of steps) {
      run(...step.run);
      if (dry && step.note) run('screenshot', join(RAW, `dry-${String(++n).padStart(2, '0')}.png`));
    }
    if (!dry) run('record', 'stop');
  } finally {
    try {
      run('close');
    } catch {}
  }
}

/** Every raw take → docs/demos/<name>.mp4 (sharp) + <name>.gif (plays inline on GitHub). */
function encode() {
  const ff = ffmpeg();
  mkdirSync(OUT, { recursive: true });
  const takes = existsSync(RAW) ? readdirSync(RAW).filter((f) => ['.mp4', '.webm'].includes(extname(f))) : [];
  for (const file of takes) {
    const name = basename(file, extname(file));
    if (!want(name)) continue;
    const phone = name === 'phone';
    const width = phone ? 390 : 1280;
    const gifWidth = phone ? 320 : 720;
    const trimFile = join(RAW, `${name}.trim`);
    const skip = existsSync(trimFile) ? ['-ss', readFileSync(trimFile, 'utf8').trim()] : [];
    const q = ['-hide_banner', '-loglevel', 'error', '-y', ...skip];
    const src = join(RAW, file);
    // agent-browser's WebM holds full-range samples; decoded as limited range, the cream paper
    // clips to white. Read it as what it is.
    const range = extname(file) === '.webm' ? 'scale=in_range=pc:out_range=tv,' : '';
    execFileSync(ff, [...q, '-i', src, '-vf', `${range}scale=${width}:-2:flags=lanczos,fps=30`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(OUT, `${name}.mp4`)]);
    const pal = join(RAW, `${name}.palette.png`);
    const filters = `${range}fps=8,scale=${gifWidth}:-1:flags=lanczos`;
    execFileSync(ff, [...q, '-i', src, '-vf', `${filters},palettegen=max_colors=96:stats_mode=diff`, pal]);
    execFileSync(ff, [...q, '-i', src, '-i', pal, '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', join(OUT, `${name}.gif`)]);
    rmSync(pal, { force: true });
    const kb = (f) => `${Math.round(statSync(join(OUT, f)).size / 1024)} KB`;
    console.log(`${name}: mp4 ${kb(`${name}.mp4`)}, gif ${kb(`${name}.gif`)}`);
  }
}

mkdirSync(RAW, { recursive: true });
if (!encodeOnly) {
  await recordTours();
  await recordGuest();
}
encode();
