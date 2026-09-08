#!/usr/bin/env node
/**
 * Drive the page as the PUBLISHED ARTIFACT, where nothing is behind it.
 *
 *   npm run secrets:verify:artifact
 *
 * The other two checks run the page against `secrets:serve`, which has a worker — so both were
 * green while the artifact was the broken one. There, a press wrote `handoffs/<slot>` and nothing
 * on earth would claim it: a queue with no consumer, indistinguishable on screen from progress.
 *
 * This loads the real built page with `window.claude.use('db')` stubbed by an in-memory store —
 * the artifact runtime's own contract, and the only part of it the page depends on — and asserts
 * the property that was violated:
 *
 *   every option that asks something of a person offers, in the artifact, a control that ends
 *   somewhere the page or the person can reach, and NO press leaves work queued for nobody.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { clientRegistry } from '../registry.mjs';
import { inStore } from '../store.mjs';
import { launchOptions } from './chromium.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Honour SECRETS_DIR like the rest of the toolchain: a check that reads a different build from
// the one it was pointed at proves nothing about that build.
const PAGE = resolve(repoRoot, inStore('secret-drop.html'));
const REG = clientRegistry();

if (!existsSync(PAGE)) { console.error('build the page first: npm run secrets:page'); process.exit(2); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright is not installed here — this check needs a browser.'); process.exit(2); }

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

/**
 * The artifact runtime, reduced to what the page uses: collections with snapshots, and documents
 * you can set/update/delete. Writes are recorded so the check can prove a press queued nothing.
 */
await page.addInitScript(() => {
  const data = new Map();
  const subs = new Map();
  window.__WRITES__ = [];
  const key = (c) => (data.has(c) ? data : data.set(c, new Map())).get(c);
  const fire = (c) => (subs.get(c) || []).forEach((fn) => fn({
    docs: [...key(c).entries()].map(([id, d]) => ({ id, data: () => d })),
  }));
  const doc = (path) => {
    const [c, ...rest] = path.split('/');
    const id = rest.join('/');
    const write = (op, v) => {
      window.__WRITES__.push({ collection: c, id, op, data: v });
      if (op === 'delete') key(c).delete(id);
      else key(c).set(id, op === 'update' ? { ...(key(c).get(id) || {}), ...v } : v);
      fire(c);
      return Promise.resolve({ ok: true });
    };
    return { set: (v) => write('set', v), update: (v) => write('update', v), delete: () => write('delete') };
  };
  window.claude = {
    use: (name) => Promise.resolve(name === 'db' ? {
      doc,
      collection: (c) => ({ onSnapshot: (fn) => { (subs.get(c) || subs.set(c, []).get(c)).push(fn); fn({ docs: [] }); return () => {}; } }),
    } : null),
  };
});

// A real navigation, so the init script is installed before the page's own script runs;
// setContent does not reliably give addInitScript a document to attach to.
await page.goto('file://' + PAGE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

const failures = [];
const check = (ok, why) => { if (!ok) failures.push(why); };

const home = await page.evaluate(() => (window.claude && Array.isArray(window.__WRITES__) ? 'ok' : 'no stub'));
if (home !== 'ok') { await browser.close(); console.error('the artifact runtime stub did not install — this check would prove nothing.'); process.exit(2); }

/** Select a provider and read back what its strip offers. */
const inspect = (slotName, optName) => page.evaluate(([n, o]) => {
  const strip = () => [...document.querySelectorAll('#open .slot, #done .row')].find((x) => x.textContent?.includes(n));
  let s = strip();
  if (!s) return { error: 'no strip' };
  if (!s.querySelector('.pick')) s.querySelector('button.link')?.click();
  s = strip();
  const tab = [...s.querySelectorAll('.pick')].find((x) => x.textContent === o);
  if (!tab) return { error: 'no tab for ' + o };
  tab.click();
  s = strip();
  if (!s) return { error: 'strip vanished after choosing' };
  return {
    controls: [...s.querySelectorAll('.act button, .act a.btn')].map((b) => b.textContent.trim()),
    links: [...s.querySelectorAll('.act a.btn')].map((a) => a.getAttribute('href')),
    text: s.textContent.replace(/\s+/g, ' ').trim(),
  };
}, [slotName, optName]);

let checked = 0;
for (const slot of REG.slots) {
  for (const opt of slot.options) {
    const got = await inspect(slot.name, opt.name);
    if (got.error) { failures.push(`${slot.id}/${opt.id}: ${got.error}`); continue; }
    checked += 1;

    if (opt.ceremony === 'signin' || opt.ceremony === 'link') {
      // The product in one assertion. Acquiring a credential is the agent's job — the ladder
      // tries ten rungs before a person is asked — so the control here must be the ask, or the
      // page running the ceremony itself where the provider's CORS headers permit it.
      const expected = opt.browserAuth ? 'Connect ' + opt.name
        : opt.ceremony === 'signin' ? 'Sign in once' : 'Get the link';
      check(got.controls.includes(expected),
        `${slot.id}/${opt.id} should lead with "${expected}" but offers [${got.controls.join(', ')}]`);

      // And it must NOT lead with the provider's key page. That is the regression this exists for:
      // the artifact once led with "Open Resend" and a field, for a provider that registers an
      // agent client with no human at all.
      check(!got.controls.some((c) => c.startsWith('Open ')),
        `${slot.id}/${opt.id} leads with a self-serve key page: [${got.controls.join(', ')}]`);
      check(!/paste it here/.test(got.text),
        `${slot.id}/${opt.id} puts a key field on the strip before anything has been asked`);
    }
  }
}

/** Choosing providers alone must not ask for anything; only a press may. */
const writes = await page.evaluate(() => window.__WRITES__);
const queued = writes.filter((w) => w.collection === 'handoffs');
check(queued.length === 0, `${queued.length} hand-off(s) written without anyone pressing anything: ${queued.map((w) => w.id).join(', ')}`);
check(writes.some((w) => w.collection === 'choices'), 'choosing a provider stored nothing at all — the check drove a dead page');

/**
 * Pressing the ask records it for the agent, and an ask nobody answers must not turn into
 * "go get it yourself" — the fallback appears BESIDE it, and the ask stays the control.
 */
{
  const pressed = await page.evaluate(() => {
    const strip = () => [...document.querySelectorAll('#open .slot')].find((x) => x.textContent?.includes('Guest email'));
    let s = strip();
    const tab = [...s.querySelectorAll('.pick')].find((x) => x.textContent === 'Postmark');
    if (tab) tab.click();
    s = strip();
    const b = [...s.querySelectorAll('.act button')].find((x) => x.textContent.trim() === 'Sign in once');
    if (!b) return { error: `no ask to press: [${[...s.querySelectorAll('.act button, .act a.btn')].map((x) => x.textContent.trim()).join(', ')}]` };
    b.click();
    return { ok: true };
  });
  if (pressed.error) failures.push(`artifact: ${pressed.error}`);
  else {
    await page.waitForTimeout(400);
    const asked = (await page.evaluate(() => window.__WRITES__)).filter((w) => w.collection === 'handoffs');
    check(asked.length === 1, `pressing the ask wrote ${asked.length} hand-offs, expected 1`);
    check(asked[0]?.data?.recipe === 'postmark-dashboard',
      `the ask carries recipe "${asked[0]?.data?.recipe}", which browser-capture cannot resolve`);

    // Now age it past the claim deadline and re-render: the ask must survive.
    const after = await page.evaluate(async () => {
      const stale = new Date(Date.now() - 5 * 60_000).toISOString();
      const db = await window.claude.use('db');
      await db.doc('handoffs/email').set({ slot: 'email', option: 'postmark', kind: 'signin', recipe: 'postmark-dashboard', requestedAt: stale, status: 'requested' });
      await new Promise((r) => setTimeout(r, 300));
      const s = [...document.querySelectorAll('#open .slot')].find((x) => x.textContent?.includes('Guest email'));
      return {
        controls: [...s.querySelectorAll('.act button, .act a.btn')].map((x) => x.textContent.trim()),
        text: s.textContent.replace(/\s+/g, ' ').trim(),
      };
    });
    check(after.controls.includes('Sign in once'),
      `an unanswered ask demoted the ask itself: [${after.controls.join(', ')}]`);
    check(/nobody has picked this up/.test(after.text), `an unanswered ask says nothing: ${after.text}`);
    check(/Get it yourself at Postmark/.test(after.text), 'no way through offered once the ask went unanswered');
  }
}

/** And a press of the self-serve route reveals the field rather than dispatching. */
{
  const before = (await page.evaluate(() => window.__WRITES__.length));
  const revealed = await page.evaluate(() => {
    const s = [...document.querySelectorAll('#open .slot, #done .row')].find((x) => x.textContent?.includes('Guest email'));
    const b = [...s.querySelectorAll('button.link')].find((x) => x.textContent.trim() === 'paste it here');
    if (!b) return 'no paste control';
    b.click();
    return s.querySelectorAll('.fields input').length ? 'fields shown' : 'nothing appeared';
  });
  check(revealed === 'fields shown', `pressing "paste it here" did: ${revealed}`);
  const after = await page.evaluate(() => window.__WRITES__);
  check(after.length === before, 'revealing a field wrote to the store');
}

/* ------------------------------------------------ and the same page with NO store at all */

// The third home: opened straight off disk, no artifact runtime and no server. Its behaviour was
// asserted in logic.mjs and never once driven, which is how a state gets tested that the page
// cannot actually reach. It can: this walks it to a sealed bundle.
{
  const bare = await browser.newPage({ viewport: { width: 390, height: 900 } });
  bare.on('pageerror', (e) => pageErrors.push('disk: ' + e));
  await bare.goto('file://' + PAGE, { waitUntil: 'domcontentloaded' });
  await bare.waitForTimeout(900);

  const walked = await bare.evaluate(() => {
    const strip = () => [...document.querySelectorAll('#open .slot')].find((x) => x.textContent?.includes('Guest email'));
    let s = strip();
    if (!s) return { error: 'the storeless page renders no strips at all' };
    const tab = [...s.querySelectorAll('.pick')].find((x) => x.textContent === 'Postmark');
    if (!tab) return { error: 'no provider tabs without a store' };
    tab.click();
    s = strip();
    const controls = [...s.querySelectorAll('.act button, .act a.btn, .act button.link')].map((b) => b.textContent.trim());
    const paste = [...s.querySelectorAll('button.link')].find((x) => x.textContent.trim() === 'paste it here');
    if (!paste) return { controls, error: 'nowhere to put a key' };
    paste.click();
    const input = strip().querySelector('.fields input');
    if (!input) return { controls, error: 'the field never appeared' };
    input.value = 'probe-not-a-real-key-0123456789';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#sealAll').click();
    return { controls, secret: input.dataset.var };
  });

  if (walked.error) failures.push(`storeless: ${walked.error}`);
  else {
    // One gesture, one control: "paste it here" and "enter it myself" do the same thing.
    const dupes = walked.controls.filter((c) => /paste it here|enter it myself/.test(c));
    check(dupes.length === 1, `storeless: ${dupes.length} controls reveal the same field: ${dupes.join(' + ')}`);
    await bare.waitForTimeout(1200);
    const sealed = await bare.evaluate(() => {
      const raw = document.querySelector('#bundle')?.value || '';
      let ok = false;
      try { const b = JSON.parse(raw); ok = Boolean(b.envelopes?.[0]?.ct) && !raw.includes('probe-not-a-real-key'); } catch { ok = false; }
      return { chars: raw.length, ciphertextOnly: ok };
    });
    check(sealed.chars > 0, 'storeless: sealing produced no bundle to paste');
    check(sealed.ciphertextOnly, 'storeless: the bundle is not ciphertext, or the typed key is in it');
  }
  await bare.close();
}

await browser.close();
if (pageErrors.length) failures.push(`the page threw: ${pageErrors.join(' | ')}`);
if (failures.length) {
  console.error(`${failures.length} problem(s) in the published artifact:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${checked} provider options checked as the published artifact — every one leads with acquiring it, not with a key field; and the storeless page seals a bundle.`);
