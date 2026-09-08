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
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { clientRegistry, CEREMONY } from '../registry.mjs';
import { attachClients } from '../oauth-clients.mjs';
import { inStore } from '../store.mjs';
import { launchOptions } from './chromium.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Honour SECRETS_DIR like the rest of the toolchain: a check that reads a different build from
// the one it was pointed at proves nothing about that build.
const PAGE = resolve(repoRoot, inStore('secret-drop.html'));
const REG = clientRegistry();
// The same clients the page was built with, so this checks the page that ships.
const ARTIFACT_URL = existsSync(inStore('page.json'))
  ? JSON.parse(await readFile(inStore('page.json'), 'utf8')).url
  : null;
await attachClients(REG, ARTIFACT_URL);

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
  // A slot with a single provider has no tabs to choose between, and rendering one would be a
  // choice that is not a choice. Nothing to click, so the strip is read as it stands.
  const tabs = [...s.querySelectorAll('.pick')];
  if (tabs.length) {
    const tab = tabs.find((x) => x.textContent === o);
    if (!tab) return { error: 'no tab for ' + o };
    tab.click();
    s = strip();
  }
  if (!s) return { error: 'strip vanished after choosing' };
  return {
    controls: [...s.querySelectorAll('.act button, .act a.btn')].map((b) => b.textContent.trim()),
    links: [...s.querySelectorAll('.act a.btn')].map((a) => a.getAttribute('href')),
    text: s.textContent.replace(/\s+/g, ' ').trim(),
  };
}, [slotName, optName]);

let checked = 0;
const leads = [];
for (const slot of REG.slots) {
  for (const opt of slot.options) {
    const got = await inspect(slot.name, opt.name);
    if (got.error) { failures.push(`${slot.id}/${opt.id}: ${got.error}`); continue; }
    checked += 1;

    leads.push({ slot: slot.id, option: opt.id, ceremony: opt.ceremony, leads: got.controls[0] || '(nothing)' });

    if (opt.ceremony === 'signin' || opt.ceremony === 'link') {
      // The product in one assertion, and the label is derived from the built-in ceremony rather
      // than written out here — so a button renamed in the template without the ceremony meaning
      // anything different is a failure, not a silent rewording.
      const cer = CEREMONY[opt.ceremony];
      // An option that names its own worker is performed by that worker: Higgsfield's session is
      // written by its CLI, and a link to higgsfield.ai would sign you in to the website while
      // leaving the CLI with nothing.
      const expected = opt.handoffKind ? 'Ask Claude to set this up'
        : opt.ceremony === 'link'
          ? (opt.oauthClient?.clientId ? `${cer.start} ${opt.name}` : 'Ask Claude to set this up')
          : `${cer.start} ${opt.name}`;
      check(got.controls.includes(expected),
        `${slot.id}/${opt.id} should lead with "${expected}" but offers [${got.controls.join(', ')}]`);

      // A `link` option must never lead with the provider's key page: something CAN acquire it,
      // and that is the regression this exists for — the artifact once led with "Open Resend"
      // and a field, for a provider that registers an agent client with no human at all.
      if (opt.ceremony === 'link') {
        check(!/paste it here/.test(got.text),
          `${slot.id}/${opt.id} puts a key field on the strip when a ceremony could acquire it`);
      }
      // Nothing may be named for a thing it does not do. "Get the link" fetched no link.
      check(!got.controls.some((c) => /^(Get the link|Connect|Open |Sign in once$)/.test(c)),
        `${slot.id}/${opt.id} offers a control named for something it does not do: [${got.controls.join(', ')}]`);
    }

    /*
     * Two rules that hold for every strip, whatever its ceremony.
     *
     * Both are things the page actually did, reported by the person using it: a control that
     * answered with "Run `npm run secrets:serve` … or ask Claude in the chat" — a terminal command
     * the reader does not have — and an "ask again" beside it that filed the identical request
     * that had already gone unanswered.
     */
    check(!/npm run|`npm|secrets:serve|in the chat/.test(got.text),
      `${slot.id}/${opt.id} tells the reader to run a terminal command: "${got.text.slice(0, 160)}"`);
    check(!got.controls.some((c) => /^ask again$/i.test(c)),
      `${slot.id}/${opt.id} offers "ask again", which repeats a request nobody answered`);
  }
}

/** Choosing providers alone must not ask for anything; only a press may. */
const writes = await page.evaluate(() => window.__WRITES__);
const queued = writes.filter((w) => w.collection === 'handoffs');
check(queued.length === 0, `${queued.length} hand-off(s) written without anyone pressing anything: ${queued.map((w) => w.id).join(', ')}`);
check(writes.some((w) => w.collection === 'choices'), 'choosing a provider stored nothing at all — the check drove a dead page');

/**
 * The press that the whole change is about.
 *
 * Reported broken by the person using it: the email strip offered "Get the link", and pressing it
 * produced a sentence telling them to run `npm run secrets:serve` next to an "ask again" that
 * re-filed the same unanswered request. Resend registers an OAuth client for an agent with no
 * human involved, so the published page has one, and this press must open Resend's own
 * authorization page — a real, standalone route that needs nobody awake.
 *
 * The assertion is on the URL actually handed to `window.open`, parameter by parameter, because a
 * button that opens the wrong URL looks exactly like one that opens the right one.
 */
{
  const email = REG.slots.find((x) => x.id === 'email');
  const resend = email.options.find((o) => o.id === 'resend');
  const opened = await page.evaluate((optName) => {
    const strip = () => [...document.querySelectorAll('#open .slot')].find((x) => x.textContent?.includes('Guest email'));
    let s = strip();
    const tab = [...s.querySelectorAll('.pick')].find((x) => x.textContent === optName);
    if (tab) tab.click();
    s = strip();
    // Capture the navigation instead of taking it; a real tab would leave the page under test.
    window.__OPENED__ = [];
    window.open = (u) => { window.__OPENED__.push(String(u)); return null; };
    const b = [...s.querySelectorAll('.act button')].find((x) => x.textContent.trim() === `Authorize ${optName}`);
    if (!b) return { error: `no Authorize button: [${[...s.querySelectorAll('.act button, .act a.btn')].map((x) => x.textContent.trim()).join(', ')}]` };
    b.click();
    return { ok: true };
  }, resend.name);

  if (opened.error) failures.push(`artifact: ${opened.error}`);
  else {
    await page.waitForTimeout(600);
    const got = await page.evaluate(() => ({
      urls: window.__OPENED__ || [],
      writes: window.__WRITES__,
    }));
    check(got.urls.length === 1, `Authorize opened ${got.urls.length} tabs, expected 1`);
    const u = got.urls[0] ? new URL(got.urls[0]) : null;
    check(Boolean(u), 'Authorize opened nothing at all');
    if (u) {
      const want = new URL(resend.oauthClient.authorizationEndpoint);
      check(u.origin + u.pathname === want.origin + want.pathname,
        `Authorize opened ${u.origin + u.pathname}, not the provider's authorization endpoint ${want.origin + want.pathname}`);
      check(u.searchParams.get('client_id') === resend.oauthClient.clientId,
        `Authorize sent client_id "${u.searchParams.get('client_id')}", not the registered one`);
      check(u.searchParams.get('response_type') === 'code', 'Authorize did not ask for a code');
      check(u.searchParams.get('code_challenge_method') === 'S256', 'Authorize did not use PKCE S256');
      check((u.searchParams.get('code_challenge') || '').length >= 43, 'Authorize sent no PKCE challenge');
      check(u.searchParams.get('redirect_uri') === resend.oauthClient.redirectUri,
        `Authorize sent redirect_uri "${u.searchParams.get('redirect_uri')}", which the provider did not register`);
    }
    // Nothing was queued for anybody: this route needs no courier at all.
    const asked = got.writes.filter((w) => w.collection === 'handoffs');
    check(asked.length === 0, `Authorize also filed ${asked.length} hand-off(s) — that is the dead request again`);
    // And the verifier is in the store BEFORE the tab opens, or the redirect could never finish.
    const cer = got.writes.filter((w) => w.collection === 'ceremonies' && w.id === 'email').pop();
    check(Boolean(cer?.data?.verifier), 'no PKCE verifier stored, so the returning code could never be redeemed');
    check(cer?.data?.status === 'waiting', `ceremony written as "${cer?.data?.status}"`);
  }
}

/**
 * And once the code is back, the control becomes the one that redeems it.
 *
 * "Approved" is not "connected", and the strip has to say which — with a press that finishes it,
 * not a sentence that waits for someone.
 */
{
  const after = await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const now = new Date().toISOString();
    await db.doc('ceremonies/email').set({
      id: 'email', credential: 'email', option: 'resend', kind: 'oauth', method: 'oauth',
      status: 'code-received', receivedAt: now, startedAt: now,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      state: 'x', verifier: 'y', client_id: 'z', redirectUri: 'https://example.invalid/',
      token_endpoint: 'https://api.resend.com/oauth/token',
    });
    await new Promise((r) => setTimeout(r, 400));
    const s = [...document.querySelectorAll('#open .slot')].find((x) => x.textContent?.includes('Guest email'));
    return {
      controls: [...s.querySelectorAll('.act button, .act a.btn')].map((x) => x.textContent.trim()),
      text: s.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  check(after.controls.some((c) => /^Claim /.test(c)),
    `an approved ceremony offers no way to claim it: [${after.controls.join(', ')}]`);
  check(!/npm run|secrets:serve|in the chat/.test(after.text),
    `the approved state tells the reader to run a terminal command: "${after.text.slice(0, 160)}"`);
}

/**
 * Choosing an option must never move the strip you chose it on.
 *
 * Reported: picking "Just link out" made the whole section disappear. Answering a slot flips
 * `needsYou` to false, and the strip left "waiting on you" for a one-line row further down the
 * page — while choosing the provider immediately beside it did nothing of the sort. One gesture,
 * two completely different consequences, and the one that removed things was the one that looked
 * like it had done nothing.
 */
{
  const moved = await page.evaluate(async () => {
    const where = () => {
      const inOpen = [...document.querySelectorAll('#open .slot')].some((x) => x.textContent?.includes('Flights & hotels'));
      const inDone = [...document.querySelectorAll('#done .row')].some((x) => x.textContent?.includes('Flights & hotels'));
      return inOpen ? 'open' : inDone ? 'done' : 'nowhere';
    };
    const before = where();
    const strip = [...document.querySelectorAll('#open .slot')].find((x) => x.textContent?.includes('Flights & hotels'));
    if (!strip) return { error: `travel strip is not in the open list to begin with (it is ${before})` };
    const tab = [...strip.querySelectorAll('.pick')].find((x) => x.textContent === 'Just link out');
    if (!tab) return { error: 'no "Just link out" tab' };
    tab.click();
    await new Promise((r) => setTimeout(r, 400));
    const after = [...document.querySelectorAll('#open .slot')].find((x) => x.textContent?.includes('Flights & hotels'));
    return { before, at: where(), text: after ? after.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
  if (moved.error) failures.push(`artifact: ${moved.error}`);
  else {
    check(moved.at === 'open', `choosing an opt-out moved the strip from ${moved.before} to ${moved.at}`);
    // The stronger form of the same rule: the list holds EVERY connection, whatever its state.
    // Answering one used to file it away in a second section, so the list you had configured was
    // never the list you came back to.
    const shown = await page.evaluate(() => ({
      strips: document.querySelectorAll('#open .slot').length,
      filedAway: document.querySelectorAll('#done .row').length,
    }));
    check(shown.strips === REG.slots.length,
      `the list shows ${shown.strips} of ${REG.slots.length} connections — one has been removed from it`);
    check(shown.filedAway === 0, `${shown.filedAway} connections were filed away into a second list`);
    // And it must not sit there still looking like it wants something.
    check(/Skipped/.test(moved.text), `the answered strip does not say it is settled: "${moved.text.slice(0, 160)}"`);
  }
}

/**
 * An option nothing can shortcut still asks — and an ask nobody answers must not turn into "go get
 * it yourself": the fallback appears BESIDE it, and the ask stays the control.
 */
{
  const stalled = await page.evaluate(async () => {
    const strip = () => [...document.querySelectorAll('#open .slot, .done .row')].find((x) => x.textContent?.includes('Database'));
    const db = await window.claude.use('db');
    await db.doc('choices/database').set({ option: 'vercel-postgres' });
    await new Promise((r) => setTimeout(r, 300));
    await db.doc('handoffs/database').set({
      slot: 'database', option: 'vercel-postgres', kind: 'link', recipe: null,
      requestedAt: new Date(Date.now() - 5 * 60_000).toISOString(), status: 'requested',
    });
    await new Promise((r) => setTimeout(r, 400));
    const s = strip();
    if (!s) return { error: 'no database strip' };
    return {
      controls: [...s.querySelectorAll('.act button, .act a.btn')].map((x) => x.textContent.trim()),
      text: s.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  if (stalled.error) failures.push(`artifact: ${stalled.error}`);
  else {
    check(stalled.controls.includes('Ask Claude to set this up'),
      `an unanswered ask demoted the ask itself: [${stalled.controls.join(', ')}]`);
    check(/nobody has picked this up/i.test(stalled.text), `an unanswered ask says nothing: ${stalled.text}`);
    check(/Get it yourself at Vercel Postgres/.test(stalled.text),
      'no way through offered once the ask went unanswered');
    check(!/npm run|secrets:serve/.test(stalled.text), `the unanswered ask names a terminal command: ${stalled.text}`);
  }
}

/** And a press of the self-serve route reveals the field rather than dispatching. */
{
  const revealed = await page.evaluate(async () => {
    const strip = () => [...document.querySelectorAll('#open .slot, #done .row')].find((x) => x.textContent?.includes('Guest email'));
    // Postmark publishes no registration endpoint, so signing in yourself IS its ceremony and the
    // field sits beside it. (Resend is mid-ceremony by now and rightly offers Claim instead.)
    const tab = [...strip().querySelectorAll('.pick')].find((x) => x.textContent === 'Postmark');
    if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 300));
    const s = strip();
    const b = [...s.querySelectorAll('button.link')].find((x) => x.textContent.trim() === 'paste it here');
    if (!b) return { state: 'no paste control', writes: window.__WRITES__.length };
    // Counted after the provider choice, which is itself a legitimate write.
    const writes = window.__WRITES__.length;
    b.click();
    return { state: s.querySelectorAll('.fields input').length ? 'fields shown' : 'nothing appeared', writes };
  });
  check(revealed.state === 'fields shown', `pressing "paste it here" did: ${revealed.state}`);
  const after = await page.evaluate(() => window.__WRITES__.length);
  check(after === revealed.writes, 'revealing a field wrote to the store');
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

/**
 * Coming back from the provider with a code, the way it really arrives.
 *
 * Reported after a Resend approval that actually succeeded: the tab that came back said "Opened
 * just now — waiting for the provider" and never moved, and the originating tab never moved
 * either. The redeem ran at bootstrap while the ceremonies snapshot was still in flight, so the
 * `state` in the URL matched nothing, the code was filed under OAUTH_CODE_PENDING, and the URL
 * was then cleaned — leaving the snapshot that arrived milliseconds later nothing to retry with.
 *
 * The stub used above cannot catch this, because it answers `onSnapshot` SYNCHRONOUSLY and a real
 * store does not. This one seeds a waiting ceremony and delivers it late, on purpose.
 */
{
  const back = await browser.newPage();
  back.on('pageerror', (e) => pageErrors.push('returning: ' + e.message));
  await back.addInitScript(() => {
    const seeded = {
      ceremonies: {
        email: {
          id: 'email', credential: 'email', option: 'resend', kind: 'oauth', method: 'oauth',
          status: 'waiting', openedAt: new Date().toISOString(), startedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          state: 'THE-STATE', verifier: 'v'.repeat(43), client_id: 'cid',
          redirectUri: 'https://example.invalid/', token_endpoint: 'https://api.resend.com/oauth/token',
        },
      },
    };
    const data = new Map(Object.entries(seeded).map(([c, docs]) => [c, new Map(Object.entries(docs))]));
    const subs = new Map();
    window.__WRITES__ = [];
    const key = (c) => (data.has(c) ? data : data.set(c, new Map())).get(c);
    const snap = (c) => ({ docs: [...key(c).entries()].map(([id, d]) => ({ id, data: () => d })) });
    const fire = (c) => (subs.get(c) || []).forEach((fn) => fn(snap(c)));
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
        collection: (c) => ({
          onSnapshot: (fn) => {
            (subs.get(c) || subs.set(c, []).get(c)).push(fn);
            // Late, like a network. This is the whole point of this pass.
            setTimeout(() => fn(snap(c)), 250);
            return () => {};
          },
        }),
      } : null),
    };
  });
  await back.goto('file://' + PAGE + '?code=THE-CODE&state=THE-STATE', { waitUntil: 'domcontentloaded' });
  await back.waitForTimeout(2000);

  const settled = await back.evaluate(() => {
    const writes = window.__WRITES__ || [];
    const cer = writes.filter((w) => w.collection === 'ceremonies' && w.id === 'email').pop();
    const env = writes.filter((w) => w.collection === 'envelopes');
    const s = [...document.querySelectorAll('#open .slot, #done .row')].find((x) => x.textContent?.includes('Guest email'));
    return {
      status: cer?.data?.status ?? null,
      envelopeNames: env.map((w) => w.id),
      text: s ? s.textContent.replace(/\s+/g, ' ').trim() : '(no email strip)',
    };
  });

  // The ceremony must have moved off `waiting`; that is what both tabs are watching for.
  check(settled.status === 'code-received' || settled.status === 'exchanging' || settled.status === 'done',
    `a returning code left the ceremony at "${settled.status}" — this is the approval that never landed`);
  // And it must be filed against the slot, not as the "nothing matched" placeholder.
  check(!settled.envelopeNames.includes('OAUTH_CODE_PENDING'),
    `the code was filed as OAUTH_CODE_PENDING: the state in the URL matched no ceremony (${settled.envelopeNames.join(', ')})`);
  check(!/waiting for the provider/.test(settled.text),
    `the strip still says it is waiting after the code came back: "${settled.text.slice(0, 160)}"`);
  await back.close();
}

await browser.close();
if (pageErrors.length) failures.push(`the page threw: ${pageErrors.join(' | ')}`);
if (failures.length) {
  console.error(`${failures.length} problem(s) in the published artifact:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
// What each option actually leads with, so the result is readable and not merely green.
for (const l of leads.filter((x) => ['link', 'signin'].includes(x.ceremony))) {
  console.log(`  ${(l.slot + '/' + l.option).padEnd(28)} ${l.ceremony.padEnd(7)} -> ${l.leads}`);
}
console.log(`${checked} provider options checked as the published artifact: every one leads with a control named for what it does, none names a terminal command, Authorize opens the provider's own PKCE authorization URL, an approved ceremony offers Claim, and the storeless page seals a bundle.`);
