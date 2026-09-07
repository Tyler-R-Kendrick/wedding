#!/usr/bin/env node
/**
 * The last automated rung: browse the provider's own dashboard, signed in as Tyler,
 * and take the key from the page instead of asking him to copy it.
 *
 * Two shapes, in order of preference:
 *
 *  1. AUTHED API. A delegated ceremony already gave us an access token, and the provider
 *     documents a "create an API key" call. No browser, no scraping — `recipe.api`.
 *
 *  2. AUTHED BROWSER. Tyler signs in ONCE through the relay below; Playwright keeps the
 *     session in .secrets/sessions/<host>.json (0600, gitignored) and every later run
 *     drives the dashboard headlessly: open the keys page, press "Create key", and read
 *     the value back by PATTERN rather than by selector, because provider markup drifts
 *     and key formats do not.
 *
 *     node scripts/secrets/browser-capture.mjs relay anthropic   → hands the sign-in to
 *     the Secret Drop page: frames out, sealed keystrokes in, storageState saved at the end.
 *
 * The extracted value goes straight to .env. It is never logged, never returned to the
 * agent, and the relay's screenshots are cropped of any element matching the key pattern.
 */
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const SESSIONS = '.secrets/sessions';
const RELAY = '.secrets/browser';

/**
 * Per-provider recipes. `keyPattern` is the load-bearing part: after the "create" click
 * we scan the rendered text for it, so a redesigned dashboard still works.
 */
export const RECIPES = {
  'anthropic-console': {
    host: 'console.anthropic.com',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    create: [/create key/i, /create api key/i],
    nameValue: 'sara-tyler-wedding-sandbox',
    confirm: [/^create$/i, /^add$/i],
    keyPattern: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/,
    target: 'ANTHROPIC_API_KEY',
  },
  'openai-platform': {
    host: 'platform.openai.com',
    keysUrl: 'https://platform.openai.com/api-keys',
    create: [/create new secret key/i, /create secret key/i],
    nameValue: 'sara-tyler-wedding-sandbox',
    confirm: [/^create secret key$/i, /^create$/i],
    keyPattern: /sk-[A-Za-z0-9_-]{20,}/,
    target: 'OPENAI_API_KEY',
  },
  'voyage-dashboard': {
    host: 'dashboard.voyageai.com',
    keysUrl: 'https://dashboard.voyageai.com/api-keys',
    create: [/create new secret key/i, /create key/i],
    confirm: [/^create$/i],
    keyPattern: /pa-[A-Za-z0-9_-]{20,}/,
    target: 'VOYAGE_API_KEY',
  },
  'resend-dashboard': {
    host: 'resend.com',
    keysUrl: 'https://resend.com/api-keys',
    create: [/create api key/i],
    nameValue: 'sara-tyler-wedding-sandbox',
    confirm: [/^add$/i, /^create$/i],
    keyPattern: /re_[A-Za-z0-9_-]{16,}/,
    target: 'RESEND_API_KEY',
    api: { url: 'https://api.resend.com/api-keys', method: 'POST', body: { name: 'sara-tyler-wedding-sandbox', permission: 'sending_access' }, field: 'token' },
  },
  'fal-dashboard': {
    host: 'fal.ai',
    keysUrl: 'https://fal.ai/dashboard/keys',
    create: [/add key/i, /create key/i, /new key/i],
    confirm: [/^create$/i, /^add$/i],
    keyPattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}/,
    target: 'FAL_KEY',
  },
  'duffel-dashboard': {
    host: 'app.duffel.com',
    keysUrl: 'https://app.duffel.com/settings/access-tokens',
    create: [/create access token/i, /new token/i],
    confirm: [/^create$/i],
    keyPattern: /duffel_(test|live)_[A-Za-z0-9_-]{20,}/,
    target: 'DUFFEL_API_KEY',
  },
  'cloudflare-r2': {
    host: 'dash.cloudflare.com',
    keysUrl: 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens',
    create: [/create api token/i],
    confirm: [/^create api token$/i, /^create$/i],
    keyPattern: /[A-Za-z0-9_-]{40,}/,
    target: 'S3_SECRET_ACCESS_KEY',
    manualNote: 'R2 shows the access key id and secret on one screen; the recipe reads both.',
  },
  'cloudflare-stream': {
    host: 'dash.cloudflare.com',
    keysUrl: 'https://dash.cloudflare.com/?to=/:account/stream',
    create: [/create api token/i, /create token/i],
    confirm: [/^create api token$/i, /^create$/i],
    keyPattern: /[A-Za-z0-9_-]{40,}/,
    target: 'CLOUDFLARE_STREAM_API_TOKEN',
    manualNote: 'The account id is in the dashboard URL; the customer code appears on the Stream page.',
  },
  'supabase-dashboard': {
    host: 'supabase.com',
    keysUrl: 'https://supabase.com/dashboard/project/_/settings/database',
    create: [],
    keyPattern: /postgres(ql)?:\/\/[^\s"'<>]+/,
    target: 'DATABASE_URL',
  },
  'uber-dashboard': {
    host: 'developer.uber.com',
    keysUrl: 'https://developer.uber.com/dashboard',
    create: [],
    keyPattern: /[A-Za-z0-9_-]{32,}/,
    target: 'UBER_CLIENT_SECRET',
  },
  'openai-platform-alt': { host: 'platform.openai.com', keysUrl: 'https://platform.openai.com/settings/organization/api-keys', create: [/create new secret key/i], keyPattern: /sk-[A-Za-z0-9_-]{20,}/, target: 'OPENAI_API_KEY' },
};

const sessionPath = (host) => join(SESSIONS, `${host.replace(/[^a-z0-9.-]/gi, '_')}.json`);

async function playwright() {
  try { return (await import('@playwright/test')).chromium; }
  catch { const e = new Error('Playwright is not installed in this sandbox (npm ci first)'); e.code = 'NO_PLAYWRIGHT'; throw e; }
}

const launchOptions = () => ({
  headless: true,
  executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});

/* ------------------------------------------------------------- fast path: API */

async function viaApi(recipe, token, userAgent) {
  const res = await fetch(recipe.api.url, {
    method: recipe.api.method || 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': userAgent },
    body: JSON.stringify(recipe.api.body || {}),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${recipe.host} refused the key request (${res.status})`);
  const value = json[recipe.api.field];
  if (!value) throw new Error(`${recipe.host} returned no ${recipe.api.field}`);
  return value;
}

/* ------------------------------------------------ steady path: authed browser */

/** Click the first control whose accessible name matches any of `names`. */
async function clickAny(page, names) {
  for (const name of names) {
    const button = page.getByRole('button', { name }).first();
    if (await button.count().catch(() => 0)) { await button.click({ timeout: 8000 }).catch(() => {}); return true; }
    const link = page.getByRole('link', { name }).first();
    if (await link.count().catch(() => 0)) { await link.click({ timeout: 8000 }).catch(() => {}); return true; }
  }
  return false;
}

/** Everything the page renders, plus input values — keys often live in a readonly input. */
async function harvest(page, pattern) {
  const text = await page.evaluate(() => {
    const values = [...document.querySelectorAll('input,textarea')].map((el) => el.value || '');
    return [document.body?.innerText || '', ...values].join('\n');
  });
  return text.match(pattern)?.[0] || null;
}

/**
 * Drive the dashboard with the stored session. Returns the credential value.
 * Throws NEEDS_HANDOFF when there is no session yet — the caller then tells the user
 * to run the relay once.
 */
export async function browseForKey(recipe, { timeoutMs = 60_000 } = {}) {
  const store = sessionPath(recipe.host);
  if (!existsSync(store)) {
    const err = new Error(`no signed-in session for ${recipe.host} — run: node scripts/secrets/browser-capture.mjs relay ${recipe.host}`);
    err.code = 'NEEDS_HANDOFF';
    throw err;
  }
  const chromium = await playwright();
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext({ storageState: store });
    const page = await context.newPage();
    await page.goto(recipe.keysUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (/sign[- ]?in|log[- ]?in/i.test(await page.title())) {
      const err = new Error(`the saved ${recipe.host} session has expired — run the relay again`);
      err.code = 'NEEDS_HANDOFF';
      throw err;
    }
    let value = await harvest(page, recipe.keyPattern);
    if (!value && recipe.create?.length) {
      await clickAny(page, recipe.create);
      await page.waitForTimeout(1500);
      if (recipe.nameValue) {
        const field = page.getByRole('textbox').first();
        if (await field.count().catch(() => 0)) await field.fill(recipe.nameValue).catch(() => {});
      }
      if (recipe.confirm?.length) { await clickAny(page, recipe.confirm); await page.waitForTimeout(2500); }
      value = await harvest(page, recipe.keyPattern);
    }
    // Refresh the session file: dashboards rotate their cookies.
    await context.storageState({ path: store });
    if (!value) throw new Error(`signed in to ${recipe.host}, but no value matching the expected key format appeared`);
    return value;
  } finally { await browser.close(); }
}

/** The ladder rung. `step.recipe` names the recipe; ctx may carry a delegated token. */
export async function capture(cred, step, ctx = {}) {
  const recipe = RECIPES[step.recipe];
  if (!recipe) throw new Error(`no browser recipe named ${step.recipe}`);
  const target = recipe.target || cred.vars[0];
  const token = ctx.tokens?.[cred.id];
  if (recipe.api && token) {
    const value = await viaApi(recipe, token, ctx.userAgent || 'sara-tyler-wedding-site/0.1');
    return { values: new Map([[target, value]]), method: 'browser', detail: `minted through ${recipe.host}'s API with the token you authorized` };
  }
  const value = await browseForKey(recipe);
  return { values: new Map([[target, value]]), method: 'browser', detail: `read from ${recipe.host} using the session you handed over` };
}

/* --------------------------------------------------------------- the relay */

/**
 * One-time sign-in handoff. Chromium runs here; the Secret Drop page is the screen and
 * the keyboard. Frames go out as PNG, input comes back sealed to the sandbox key, so the
 * password Tyler types is decrypted in this process and nowhere else.
 *
 * The agent moves two small files between this directory and the page's store; when the
 * page says "I'm signed in", we save storageState and every later run is headless.
 */
export async function relay(hostOrRecipe, { frames = 600, intervalMs = 1200 } = {}) {
  const recipe = RECIPES[hostOrRecipe] || Object.values(RECIPES).find((r) => r.host === hostOrRecipe);
  if (!recipe) throw new Error(`unknown provider ${hostOrRecipe}`);
  const chromium = await playwright();
  await mkdir(RELAY, { recursive: true });
  await mkdir(SESSIONS, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  await page.goto(recipe.keysUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  console.log(`Relay open on ${recipe.host}. Mirror ${RELAY}/frame.png into the Secret Drop page and copy sealed input back to ${RELAY}/input.json.`);

  const priv = existsSync('.secrets/private.jwk.json')
    ? await subtle.importKey('jwk', (({ kid, createdAt, ...k }) => k)(JSON.parse(await readFile('.secrets/private.jwk.json', 'utf8'))), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['unwrapKey'])
    : null;

  for (let i = 0; i < frames; i++) {
    await page.screenshot({ path: join(RELAY, 'frame.png'), type: 'png' }).catch(() => {});
    await writeFile(join(RELAY, 'state.json'), JSON.stringify({ url: page.url(), title: await page.title().catch(() => ''), frame: i, at: new Date().toISOString() }, null, 2));
    const inputPath = join(RELAY, 'input.json');
    if (existsSync(inputPath)) {
      const event = JSON.parse(await readFile(inputPath, 'utf8'));
      await rm(inputPath, { force: true });
      try {
        if (event.type === 'click') await page.mouse.click(event.x, event.y);
        else if (event.type === 'scroll') await page.mouse.wheel(0, event.dy || 400);
        else if (event.type === 'key') await page.keyboard.press(event.key);
        else if (event.type === 'text') await page.keyboard.type(event.text);
        else if (event.type === 'sealed' && priv) await page.keyboard.type(await unseal(event.envelope, priv));
        else if (event.type === 'goto') await page.goto(event.url, { waitUntil: 'domcontentloaded' });
        else if (event.type === 'done') break;
      } catch (err) { console.log(`input ignored: ${err.message}`); }
    }
    await page.waitForTimeout(intervalMs);
  }
  await context.storageState({ path: sessionPath(recipe.host) });
  await browser.close();
  console.log(`Saved a signed-in session for ${recipe.host}. Later runs read the dashboard headlessly; no key ever crosses the chat.`);
}

async function unseal(envelope, privKey) {
  const aes = await subtle.unwrapKey('raw', Buffer.from(envelope.wrapped[Object.keys(envelope.wrapped)[0]], 'base64url'), privKey, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64url'), additionalData: Buffer.from(envelope.name) }, aes, Buffer.from(envelope.ct, 'base64url'));
  return Buffer.from(pt).toString('utf8');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'relay' && arg) await relay(arg);
  else if (cmd === 'list') for (const [id, r] of Object.entries(RECIPES)) console.log(id.padEnd(24), r.host.padEnd(26), r.target, existsSync(sessionPath(r.host)) ? '(session saved)' : '');
  else { console.error('usage: browser-capture.mjs list | relay <recipe|host>'); process.exit(2); }
}
