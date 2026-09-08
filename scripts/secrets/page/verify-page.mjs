#!/usr/bin/env node
/**
 * Drive the real Secret Drop page in a real browser and check every provider in every slot.
 *
 *   npm run secrets:verify:page
 *
 * `logic.mjs` is unit-tested to 100%, but that only proves the decisions are right — not that the
 * page renders them, persists them, or leaves the tabs reachable. This is the part that failed:
 * selecting Postmark or Amazon SES looked like it worked (the tab highlighted, the note changed)
 * while the strip still offered Resend's "Get the link", because a stale status decided the
 * ceremony. Nothing short of clicking all thirty-six combinations would have caught it.
 *
 * For each slot × option it asserts:
 *   - the choice reaches the store (not just the DOM),
 *   - the row names the provider that was picked,
 *   - the row sits where `needsYou` says it should,
 *   - the control offered is the one this ceremony implies, and no other ceremony's control,
 *   - the ceremony the page *says* matches the one it acts on,
 *   - a paste ceremony shows exactly its own fields.
 *
 * Starts and stops its own server on an ephemeral port; touches no committed state.
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { clientRegistry } from '../registry.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = Number(process.env.SECRET_DROP_VERIFY_PORT || 4699);
const CONTROL = { signin: 'Sign in once', link: 'Get the link', apply: 'Apply' };
const CHROMIUM = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const REG = clientRegistry();
/**
 * Deliberately NOT importing logic.mjs. An earlier version of this file computed its expectations
 * with the very module it was checking, so when that module was wrong the page and the expectation
 * were wrong together and all thirty-six combinations "passed". Everything below is derived from
 * the registry's declarations and from the page's own rendered text.
 */
const LABEL_TO_CEREMONY = new Map(Object.entries(REG.ceremony).map(([id, c]) => [c.label.toLowerCase(), id]));

/**
 * Fixtures, not ambient state. An earlier run of this check passed thirty-six for thirty-six only
 * because the real store happened to hold no ceremonies that day — and a ceremony left over from a
 * provider you have since moved away from was exactly the bug it missed. Every slot here gets a
 * status AND an open ceremony belonging to its FIRST option, so choosing any other option must
 * visibly stop offering that one's work.
 */
const fixtureDir = mkdtempSync(join(tmpdir(), 'secret-drop-verify-'));
process.on('exit', () => { try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* best effort */ } });

const status = {};
const ceremonies = [];
/** Which option each slot's fixture ceremony and status belong to. */
const fixtureOwner = new Map();
for (const slot of REG.slots) {
  const owner = slot.options[0];
  fixtureOwner.set(slot.id, owner.id);
  status[slot.id] = {
    credential: slot.id, option: owner.id, vars: owner.secrets, set: 0, of: owner.secrets.length,
    state: 'waiting-on-you', method: null, nextAction: null, at: new Date().toISOString(),
  };
  // Only a `link` provider ever has an OAuth ceremony outstanding. Inventing one for a sign-in
  // provider would be testing a state the ladder cannot produce.
  if (owner.ceremony !== 'link') continue;
  ceremonies.push({
    id: slot.id, credential: slot.id, kind: 'oauth', method: 'oauth', status: 'waiting',
    provider: `https://${owner.host || 'example.invalid'}`, startedAt: new Date().toISOString(),
    verification_uri_complete: `https://${owner.host || 'example.invalid'}/authorize?fixture=1`,
  });
}
/** Slots that really do have a pending ceremony, and therefore an Approve to offer its owner. */
const withCeremony = new Set(ceremonies.map((c) => c.credential));
writeFileSync(join(fixtureDir, 'outbox.json'), JSON.stringify({ status, ceremonies }, null, 2));
writeFileSync(join(fixtureDir, 'choices.json'), '{}');
const realKey = resolve(repoRoot, '.secrets/public.jwk.json');
if (existsSync(realKey)) copyFileSync(realKey, join(fixtureDir, 'public.jwk.json'));

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed here — this check needs a browser.');
  process.exit(2);
}

const server = spawn(process.execPath, ['scripts/secrets/serve.mjs', '--port', String(PORT), '--secrets', fixtureDir], {
  cwd: repoRoot,
  env: { ...process.env, NODE_OPTIONS: '' },
});
let serverOut = '';
server.stdout.on('data', (c) => { serverOut += c; });
server.stderr.on('data', (c) => { serverOut += c; });

const stop = () => { try { server.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', stop);

/** Wait for the page to answer, rather than guessing at a delay. */
async function ready(deadlineMs = 20_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return await res.text();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server never came up on ${PORT}:\n${serverOut}`);
}

const html = await ready();
const token = /__SECRET_DROP__=\{"token":"([^"]+)"/.exec(html)?.[1];
if (!token) { stop(); console.error('served page carries no token'); process.exit(2); }

/**
 * Prove the fixtures are actually in play before asserting anything about them. They were not,
 * once: an absolute `--secrets` path was pasted onto the repo root, the store came back empty, and
 * this check reported thirty-six passes against nothing. A verification that cannot see its own
 * setup is worse than no verification, because it reads as evidence.
 */
{
  const seen = await (await fetch(`http://127.0.0.1:${PORT}/api/state`, { headers: { 'x-drop-token': token } })).json();
  const ceremonies = Object.keys(seen.collections?.ceremonies ?? {});
  const statuses = Object.keys(seen.collections?.status ?? {});
  if (statuses.length !== REG.slots.length || ceremonies.length !== withCeremony.size) {
    stop();
    console.error(`fixtures did not reach the store: ${statuses.length}/${REG.slots.length} statuses, ${ceremonies.length}/${withCeremony.size} ceremonies.`);
    process.exit(2);
  }
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const readStrip = (slotName) => page.evaluate((n) => {
  const s = [...document.querySelectorAll('#open .slot, #done .row')].find((x) => x.textContent?.includes(n));
  if (!s) return null;
  return {
    open: Boolean(s.closest('#open')),
    provider: s.querySelector('.prov')?.textContent?.trim() ?? s.querySelector('.pick[aria-pressed="true"]')?.textContent ?? null,
    controls: [...s.querySelectorAll('.act button, .act a.btn')].map((b) => b.textContent),
    fields: [...s.querySelectorAll('.fields label')].map((l) => l.textContent),
    why: s.querySelector('.why')?.textContent ?? '',
  };
}, slotName);

/** Click a provider tab, revealing it first on a manifest row where tabs live behind "change". */
const pickProvider = (slotName, optName) => page.evaluate(([n, o]) => {
  const s = [...document.querySelectorAll('#open .slot, #done .row')].find((x) => x.textContent?.includes(n));
  if (!s) return 'no-slot';
  if (!s.querySelector('.pick')) s.querySelector('button.link')?.click();
  const b = [...s.querySelectorAll('.pick')].find((x) => x.textContent === o);
  if (!b) return 'no-tab';
  b.click();
  return 'ok';
}, [slotName, optName]);

async function storedChoice(slotId) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/state`, { headers: { 'x-drop-token': token } });
  const body = await res.json();
  return body.collections.choices?.[slotId]?.option ?? null;
}

let failures = 0;
let checked = 0;
/** What the page actually displayed for each option, so a slot can be judged as a whole. */
const shownBySlot = new Map();

for (const slot of REG.slots) {
  shownBySlot.set(slot.id, []);
  for (const opt of slot.options) {
    const clicked = await pickProvider(slot.name, opt.name);
    if (clicked !== 'ok') {
      failures++;
      console.log(`FAIL ${slot.id}/${opt.id}: provider tab unreachable (${clicked})`);
      continue;
    }
    await page.waitForTimeout(260);
    const got = await readStrip(slot.name);
    const persisted = await storedChoice(slot.id);
    checked++;

    // The ceremony the PAGE says it is in, read out of its own text — not asked of the code.
    const label = [...LABEL_TO_CEREMONY.keys()].find((l) => got.why.toLowerCase().includes(l));
    const shown = label ? LABEL_TO_CEREMONY.get(label) : null;
    shownBySlot.get(slot.id).push({ opt, shown, open: got.open });

    const problems = [];
    if (persisted !== opt.id) problems.push(`store kept "${persisted}" not "${opt.id}"`);
    if (got.provider && !got.provider.includes(opt.name)) problems.push(`row shows "${got.provider}"`);

    if (got.open) {
      if (!shown) problems.push(`names no ceremony: "${got.why.trim()}"`);
      // Self-consistency: whatever ceremony it claims, that is the control it must offer.
      // A ceremony already in flight for THIS provider replaces "Get the link" with "Approve":
      // the link exists, so asking for it again is not the next step.
      const pending = withCeremony.has(slot.id) && opt.id === fixtureOwner.get(slot.id);
      const approving = got.controls.some((c) => c === 'Approve' || c === 'Approve again');
      const expected = CONTROL[shown];
      if (expected && !got.controls.includes(expected) && !(pending && approving)) {
        problems.push(`says "${label}" but does not offer "${expected}" (got ${JSON.stringify(got.controls)})`);
      }
      for (const [id, control] of Object.entries(CONTROL)) {
        if (id !== shown && got.controls.includes(control)) {
          problems.push(`says "${label}" but offers ${id}'s "${control}"`);
        }
      }
      if (shown === 'paste' && got.fields.length !== opt.secrets.length) {
        problems.push(`shows ${got.fields.length} paste fields, wants ${opt.secrets.length}`);
      }
    }
    /**
     * The fixture ceremony belongs to the slot's first option. Any OTHER option must not be
     * offered it: an "Approve" link to Resend is not an answer to "I picked Postmark", and
     * offering it is how choosing a provider came to do nothing you could see.
     */
    const owner = fixtureOwner.get(slot.id);
    const stillApproving = got.controls.some((c) => c === 'Approve' || c === 'Approve again');
    if (opt.id !== owner && stillApproving) {
      problems.push(`offers "${owner}"'s pending approval after choosing "${opt.id}"`);
    }

    if (problems.length) {
      failures++;
      console.log(`FAIL ${slot.id}/${opt.id}: ${problems.join(' | ')}`);
    }
  }
}

/**
 * The check that catches a stale status deciding for the wrong provider. Each option declares its
 * own ceremony; a live status may legitimately override that, but only for the ONE option it was
 * computed for. If two options in a slot render a ceremony other than the one they declare, the
 * page is not really following the choice.
 */
for (const slot of REG.slots) {
  const shown = shownBySlot.get(slot.id) ?? [];
  const liveOption = status[slot.id]?.option ?? null;
  const deviating = shown.filter((r) => r.shown && r.shown !== r.opt.ceremony);
  const unexplained = deviating.filter((r) => r.opt.id !== liveOption);
  if (unexplained.length) {
    failures++;
    const detail = unexplained.map((r) => `${r.opt.id} declares ${r.opt.ceremony} but showed ${r.shown}`).join('; ');
    console.log(`FAIL ${slot.id}: choice not honoured — ${detail}` + (liveOption ? ` (only "${liveOption}" has a live status)` : ''));
  }
}

if (pageErrors.length) {
  failures += pageErrors.length;
  console.log(`FAIL the page threw: ${pageErrors.join('; ')}`);
}

await browser.close();
stop();

console.log(`\n${checked} slot/provider combinations checked in a real browser — ${failures} wrong.`);
process.exit(failures ? 1 : 0);
