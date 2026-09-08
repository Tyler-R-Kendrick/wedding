#!/usr/bin/env node
/**
 * Press the buttons and watch what happens next.
 *
 *   npm run secrets:verify:lifecycle
 *
 * `verify-page.mjs` proves the right control is offered. This proves the control *does something
 * and says what* — which is the part that was broken: "Asked just now — Claude is on it" was
 * written the instant a hand-off record was created and never changed again, because nothing
 * anywhere consumed hand-offs. A frozen sentence renders exactly like a working one, so nothing
 * short of pressing the button and watching the text over time can tell them apart.
 *
 * It asserts, against a real server doing real work:
 *   - pressing a control dispatches a job (the store leaves `requested`),
 *   - the page's own text changes to say so, and names something that is actually happening,
 *   - a job whose server died is reported as failed rather than left running for ever,
 *   - a returned OAuth code is exchanged rather than left at "finishing up".
 *
 * Nothing here is stubbed: the work that runs is the work the page dispatches in earnest. What is
 * asserted is the reporting, not the outcome — signing in to Postmark from a sandbox is expected
 * to fail, and a failure that is *reported* is the passing case.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, copyFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { clientRegistry } from '../registry.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = Number(process.env.SECRET_DROP_LIFECYCLE_PORT || 4698);
const CHROMIUM = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const REG = clientRegistry();

/** A slot whose chosen provider signs in, and one whose provider hands back a link. */
const signin = REG.slots.flatMap((s) => s.options.map((o) => ({ slot: s, option: o })))
  .find(({ option }) => option.ceremony === 'signin' && option.recipe);
// A different slot from the sign-in one: they are exercised in the same session, and choosing a
// provider in a slot correctly hides that slot's other ceremonies.
const link = REG.slots.flatMap((s) => s.options.map((o) => ({ slot: s, option: o })))
  .find(({ slot, option }) => option.ceremony === 'link' && slot.id !== signin.slot.id);
if (!signin || !link) { console.error('the registry offers no sign-in or link provider to exercise'); process.exit(2); }

const store = mkdtempSync(join(tmpdir(), 'secret-drop-life-'));
process.on('exit', () => { try { rmSync(store, { recursive: true, force: true }); } catch { /* best effort */ } });
writeFileSync(join(store, 'choices.json'), JSON.stringify({
  [signin.slot.id]: { slot: signin.slot.id, option: signin.option.id },
  [link.slot.id]: { slot: link.slot.id, option: link.option.id },
}, null, 2));
writeFileSync(join(store, 'outbox.json'), JSON.stringify({ status: {}, ceremonies: [] }, null, 2));
const realKey = resolve(repoRoot, '.secrets/public.jwk.json');
if (existsSync(realKey)) copyFileSync(realKey, join(store, 'public.jwk.json'));

/** File names and mtimes, so "nothing else was touched" is checkable rather than assumed. */
const snapshot = (dir) => {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    try { out.set(entry.name, entry.isDirectory() ? 'dir' : String(statSync(path).mtimeMs)); }
    catch { out.set(entry.name, 'gone'); }
  }
  return out;
};
const realBefore = snapshot(resolve(repoRoot, '.secrets'));
const realEnvBefore = existsSync(resolve(repoRoot, '.env')) ? String(statSync(resolve(repoRoot, '.env')).mtimeMs) : 'absent';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright is not installed here — this check needs a browser.'); process.exit(2); }

let server = null;
const startServer = () => {
  server = spawn(process.execPath, ['scripts/secrets/serve.mjs', '--port', String(PORT), '--secrets', store, '--env', join(store, 'env'), '--no-open'], {
    cwd: repoRoot, env: { ...process.env, NODE_OPTIONS: '' },
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});
};
const stopServer = () => { try { server?.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', stopServer);

async function ready(deadlineMs = 20_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) return await r.text(); }
    catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server never came up on ${PORT}`);
}

startServer();
// The boot token is minted per process, so a restarted server needs its token read again —
// otherwise every later probe is silently unauthorised and reads as "nothing happened".
let token = null;
const readToken = (html) => {
  token = /__SECRET_DROP__=\{"token":"([^"]+)"/.exec(html)?.[1] ?? null;
  if (!token) { stopServer(); console.error('served page carries no token'); process.exit(2); }
};
readToken(await ready());
const state = async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/state`, { headers: { 'x-drop-token': token } });
  if (!res.ok) throw new Error(`/api/state answered ${res.status} — the probe is not authorised`);
  return res.json();
};

/** Poll until `read` returns something truthy, or give up and say what it kept seeing. */
async function until(what, read, ms = 45_000) {
  const stop = Date.now() + ms;
  let last;
  while (Date.now() < stop) {
    last = await read();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${what} — never happened within ${ms / 1000}s (last saw: ${JSON.stringify(last)})`);
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

const failures = [];
const check = (ok, why) => { if (!ok) failures.push(why); };

/** Strips carry no id, so they are found the way a person finds them: by the slot's name. */
const stripText = (slotName) => page.evaluate((n) => {
  const s = [...document.querySelectorAll('#open .slot, #done .row')].find((x) => x.textContent?.includes(n));
  return (s?.textContent || '').replace(/\s+/g, ' ').trim();
}, slotName);

/** Press a named control inside one slot's strip; returns what it found. */
const press = (slotName, label) => page.evaluate(([n, l]) => {
  const s = [...document.querySelectorAll('#open .slot, #done .row')].find((x) => x.textContent?.includes(n));
  if (!s) return 'no-slot';
  const b = [...s.querySelectorAll('.act button, .act a.btn, button.link')].find((x) => x.textContent?.trim() === l);
  if (!b) return `no-control (${[...s.querySelectorAll('.act button, .act a.btn')].map((x) => x.textContent).join(', ') || 'none'})`;
  b.click();
  return 'ok';
}, [slotName, label]);

/** Click a provider tab, revealing it first where the tabs live behind "change". */
const pickProvider = (slotName, optName) => page.evaluate(([n, o]) => {
  const s = [...document.querySelectorAll('#open .slot, #done .row')].find((x) => x.textContent?.includes(n));
  if (!s) return 'no-slot';
  if (!s.querySelector('.pick')) s.querySelector('button.link')?.click();
  const b = [...s.querySelectorAll('.pick')].find((x) => x.textContent === o);
  if (!b) return 'no-tab';
  b.click();
  return 'ok';
}, [slotName, optName]);

/* ------------------------------------------------- 1. a press dispatches work and says so */

const picked = await pickProvider(signin.slot.name, signin.option.name);
if (picked !== 'ok') { console.error(`could not select ${signin.slot.id}/${signin.option.id}: ${picked}`); process.exit(2); }
await page.waitForTimeout(300);

const before = await stripText(signin.slot.name);
const pressed = await press(signin.slot.name, 'Sign in once');
if (pressed !== 'ok') { console.error(`no "Sign in once" on ${signin.slot.id}/${signin.option.id}: ${pressed}`); process.exit(2); }

const dispatched = await until('the hand-off left "requested"', async () => {
  const h = (await state()).collections?.handoffs?.[signin.slot.id];
  return h && h.status !== 'requested' ? h : null;
});
check(dispatched.recipe === signin.option.recipe,
  `the page sent recipe "${dispatched.recipe}", not the option's "${signin.option.recipe}" — the worker resolves recipes, not brand hosts`);

const moved = await until('the strip stopped saying the same thing', async () => {
  const now = await stripText(signin.slot.name);
  return now && now !== before ? now : null;
});
check(!/Claude is on it/i.test(moved), `the strip still says "Claude is on it": ${moved}`);
check(/Signing in|Failed|Asked/i.test(moved), `the strip says nothing about the work it dispatched: ${moved}`);

// Whatever it is doing, it must reach a state the page can name, and name a reason if it failed.
const settled = await until('the job reached a terminal or running state', async () => {
  const h = (await state()).collections?.handoffs?.[signin.slot.id];
  return ['running', 'done', 'failed'].includes(h?.status) ? h : null;
});
if (settled.status === 'failed') {
  check(Boolean(settled.detail), 'a failed hand-off carried no reason at all');
  check(!/^\s*at\s|node:internal/.test(String(settled.detail)), `the reason shown is a stack frame, not a reason: ${settled.detail}`);
  check(!/unknown provider/i.test(String(settled.detail)), `the page dispatched something the worker cannot resolve: ${settled.detail}`);
} else {
  const running = await stripText(signin.slot.name);
  check(/Signing in/i.test(running), `work is running but the strip does not say so: ${running}`);
}

/* ------------------------------------------------- 2. a job whose server died is not left running */

if (settled.status === 'running') {
  stopServer();
  await new Promise((r) => setTimeout(r, 500));
  startServer();
  readToken(await ready());
  const reaped = await until('the abandoned job was reaped', async () => {
    const h = (await state()).collections?.handoffs?.[signin.slot.id];
    return h?.status === 'failed' ? h : null;
  }, 20_000);
  check(/server stopped/i.test(String(reaped.detail)), `an abandoned job was not explained: ${reaped.detail}`);
  await page.reload({ waitUntil: 'networkidle' });
  const after = await stripText(signin.slot.name);
  check(/Failed/i.test(after), `a dead job still reads as live on the page: ${after}`);
  check(/try again/i.test(after), `a dead job offers no way back: ${after}`);
}

/* ------------------------------------------------- 3. a returned code is exchanged, not parked */

const ceremonyId = link.slot.id;
writeFileSync(join(store, 'ceremonies.json'), JSON.stringify({
  [ceremonyId]: {
    id: ceremonyId, credential: ceremonyId, kind: 'oauth', method: 'oauth', status: 'waiting',
    option: link.option.id, startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    state: 'fixture-state', token_endpoint: 'https://127.0.0.1:9/token', client_id: 'fixture', redirectUri: 'https://example.invalid/cb',
    verification_uri_complete: `https://${link.option.host || 'example.invalid'}/authorize?fixture=1`,
  },
}, null, 2));
const outbox = JSON.parse(readFileSync(join(store, 'outbox.json'), 'utf8'));
outbox.ceremonies = Object.values(JSON.parse(readFileSync(join(store, 'ceremonies.json'), 'utf8')));
writeFileSync(join(store, 'outbox.json'), JSON.stringify(outbox, null, 2));

// The page seals the code itself; here we post the envelope the way the page's `takeCode` does.
const name = `OAUTH_CODE_${ceremonyId.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
const posted = await fetch(`http://127.0.0.1:${PORT}/api/doc`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-drop-token': token },
  body: JSON.stringify({ path: `envelopes/${name}`, op: 'set', data: { name, iv: 'AA', ct: 'AA', wrapped: { nobody: 'AA' } } }),
});
check(posted.ok, `posting a returned code was refused: ${posted.status} ${await posted.text()}`);

const exchanged = await until('the returned code was picked up', async () => {
  const c = ((await state()).collections?.ceremonies ?? {})[ceremonyId];
  return c && c.status !== 'waiting' && c.status !== 'code-received' ? c : null;
});
check(['running', 'exchanging', 'done', 'failed'].includes(exchanged.status),
  `a returned code parked at "${exchanged.status}" — nothing exchanged it`);

await page.reload({ waitUntil: 'networkidle' });
const settleText = await stripText(link.slot.name);
check(!/finishing up/i.test(settleText), `the strip still says "finishing up" with nothing finishing it: ${settleText}`);
// The store and the page have to agree, so read the store again *now* rather than trusting the
// status from before the reload — a short exchange finishes while the page is still loading.
const settledNow = ((await state()).collections?.ceremonies ?? {})[ceremonyId] ?? exchanged;
if (['running', 'exchanging'].includes(settledNow.status)) {
  check(/Exchanging the code/i.test(settleText), `the exchange is running but the strip does not say so: ${settleText}`);
} else if (settledNow.status === 'failed') {
  check(/Could not finish/i.test(settleText), `the exchange failed but the strip does not say so: ${settleText}`);
  check(Boolean(settledNow.detail), 'a failed exchange carried no reason at all');
  check(settleText.includes(String(settledNow.detail)), `the reason is recorded but not shown: ${settledNow.detail}`);
  check(/start over/i.test(settleText), `a failed exchange offers no way back: ${settleText}`);
}

/* ------------------------------- 4. the local bar's run buttons report an outcome */

// These blocked with a static line and a disabled button; a run that takes minutes looked the
// same as one that had stopped. They must show progress and then say how it ended.
{
  const bar = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#local button')].find((x) => /needs no account/i.test(x.textContent || ''));
    if (!b) return 'no-button';
    b.click();
    return 'ok';
  });
  check(bar === 'ok', `the local bar offers no run button: ${bar}`);
  if (bar === 'ok') {
    // While it runs, the status must be live rather than a sentence — a spinner and an elapsed time.
    const sawProgress = await page.evaluate(() => Boolean(document.querySelector('#localStatus .spin')));
    const ended = await until('the run reported how it ended', async () => {
      const text = await page.evaluate(() => document.querySelector('#localStatus')?.textContent || '');
      return /finished\.|exited \d|Could not run/.test(text) ? text : null;
    }, 120_000);
    const out = await page.evaluate(() => document.querySelector('#localOut')?.textContent || '');
    check(Boolean(out.trim()), 'a finished run showed no output at all');
    check(sawProgress || /finished\./.test(ended), `a run in flight showed no progress: ${ended}`);
  }
}

/* ------------------------------- 5. the fixture store is the only store that was touched */

// `--secrets` is a promise about the whole toolchain: the jobs this server spawns must read and
// write the directory it was pointed at, not the developer's real one. It did not, once.
{
  const now = snapshot(resolve(repoRoot, '.secrets'));
  const changed = [...now.keys()].filter((f) => realBefore.get(f) !== now.get(f));
  check(changed.length === 0, `this check wrote to the real store: ${changed.join(', ')}`);
  // The same for the developer's environment file, which the ladder appends to on success.
  const envNow = existsSync(resolve(repoRoot, '.env')) ? String(statSync(resolve(repoRoot, '.env')).mtimeMs) : 'absent';
  check(envNow === realEnvBefore, 'this check wrote to the real .env');
}

/* ---------------------------------------------------------------------------------- verdict */

await browser.close();
stopServer();
if (pageErrors.length) failures.push(`the page threw: ${pageErrors.join(' | ')}`);
if (failures.length) {
  console.error(`${failures.length} control${failures.length === 1 ? ' reports' : 's report'} work that is not happening:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('Pressed for real: work dispatched, progress shown, outcomes reported — no frozen sentences.');
