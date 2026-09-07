#!/usr/bin/env node
/**
 * The Secret Drop, as a local web app.
 *
 *   npm run secrets:serve            → http://127.0.0.1:4600
 *   npm run secrets:serve -- --port 5000 --no-open
 *
 * Same page as the published artifact, same registry, same envelope format — but backed by the
 * files under `.secrets/` instead of the artifact store, and able to act on what it receives.
 * That removes the courier: an envelope sealed in the browser is decrypted here with the sandbox
 * private key and written straight to `.env`, and the ladder can be run from the page itself.
 *
 * What it will not do. It binds to the loopback interface only, every `/api/*` call carries a
 * token minted at boot and injected into the page, the Host header must be a loopback name, and
 * `/api/run` accepts three fixed commands — never a string from the request. Values are decrypted
 * to be written to `.env` and are never returned to the browser, logged, or held after the write.
 *
 * A developer needs no Claude session to use this: it is the same environment setup, self-served.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { applyEnv, describe, NAME_RE } from './env-file.mjs';

const { subtle } = webcrypto;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const at = (...p) => join(repoRoot, ...p);

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', process.env.SECRET_DROP_PORT || 4600));
const envPath = opt('env', '.env');

/** Files the page's collections are projected from. Nothing else on disk is reachable. */
const FILES = {
  outbox: at('.secrets/outbox.json'),
  choices: at('.secrets/choices.json'),
  handoffs: at('.secrets/handoffs.json'),
  applied: at('.secrets/applied.json'),
  publicKey: at('.secrets/public.jwk.json'),
  privateKey: at('.secrets/private.jwk.json'),
  page: at('.secrets/secret-drop.html'),
};

/** The ladder, as the page may invoke it. Fixed argv — never a string from the request. */
const COMMANDS = {
  autofill: ['scripts/secrets/autofill.mjs'],
  acquire: ['scripts/secrets/acquire.mjs', 'run'],
  verify: ['scripts/secrets/verify.mjs'],
};

const token = randomBytes(24).toString('base64url');
let rev = 0;
const bump = () => { rev += 1; };

const readJson = async (path, fallback) => {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
};
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
  bump();
};

/* ------------------------------------------------------------------ the store */

/**
 * The five collections the page subscribes to, projected from the files the CLI already writes.
 * `envelopes` deliberately holds only names and timestamps: the values went to `.env` and are not
 * kept here for the browser to read back.
 */
async function collections() {
  const outbox = await readJson(FILES.outbox, {});
  const pub = await readJson(FILES.publicKey, null);
  return {
    status: outbox.status || {},
    ceremonies: Object.fromEntries((outbox.ceremonies || []).map((c) => [c.id, c])),
    choices: await readJson(FILES.choices, {}),
    handoffs: await readJson(FILES.handoffs, {}),
    applied: await readJson(FILES.applied, {}),
    recipients: pub?.kid ? { [pub.kid]: pub } : {},
    envelopes: await readJson(FILES.applied, {}),
  };
}

async function privateKey() {
  const raw = process.env.SECRETS_PRIVATE_KEY
    ? JSON.parse(Buffer.from(process.env.SECRETS_PRIVATE_KEY, 'base64url').toString('utf8'))
    : existsSync(FILES.privateKey) ? JSON.parse(await readFile(FILES.privateKey, 'utf8')) : null;
  if (!raw) return null;
  const { kid, createdAt, ...pure } = raw;
  return { kid, key: await subtle.importKey('jwk', pure, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['unwrapKey']) };
}

/** Open one envelope. Mirrors the page's seal exactly: AES-256-GCM, AAD = the variable name. */
async function unseal(envelope, priv) {
  const ek = envelope.wrapped?.[priv.kid];
  if (!ek) throw new Error(`sealed for ${Object.keys(envelope.wrapped || {}).join(', ') || 'nobody'}, not for ${priv.kid}`);
  const b = (v) => Buffer.from(String(v).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const aes = await subtle.unwrapKey('raw', b(ek), priv.key, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b(envelope.iv), additionalData: Buffer.from(envelope.name) }, aes, b(envelope.ct));
  return Buffer.from(pt).toString('utf8');
}

/**
 * One document write from the page. `envelopes/<NAME>` is the interesting one: it is not stored,
 * it is opened and applied, and only the name and the time survive.
 */
async function writeDoc(path, op, data) {
  const [collection, ...rest] = path.split('/');
  const id = rest.join('/');
  if (!id) throw new Error('a document path needs a collection and an id');

  if (collection === 'envelopes') {
    if (op === 'delete') {
      const applied = await readJson(FILES.applied, {});
      delete applied[id];
      await writeJson(FILES.applied, applied);
      return { removed: id };
    }
    if (!NAME_RE.test(data?.name || id)) throw new Error('not a variable name');
    const priv = await privateKey();
    if (!priv) throw new Error('no private key here — run `node scripts/secrets/keygen.mjs` first');
    const value = await unseal({ ...data, name: data?.name || id }, priv);
    const entries = new Map([[data?.name || id, value]]);
    const { updated, added } = await applyEnv(entries, { path: at(envPath), note: 'scripts/secrets/serve.mjs' });
    const applied = await readJson(FILES.applied, {});
    // Names and lengths only. The value is already in .env and is not kept anywhere else.
    applied[id] = { name: data?.name || id, appliedAt: new Date().toISOString(), chars: value.length, where: envPath };
    await writeJson(FILES.applied, applied);
    console.log(`  applied ${describe(entries)[0] || id} → ${envPath} (updated=[${updated}] added=[${added}])`);
    return { applied: id };
  }

  const file = { choices: FILES.choices, handoffs: FILES.handoffs }[collection];
  if (file) {
    const all = await readJson(file, {});
    if (op === 'delete') delete all[id];
    else all[id] = op === 'update' ? { ...(all[id] || {}), ...data } : data;
    await writeJson(file, all);
    return { [op]: path };
  }

  if (collection === 'ceremonies') {
    const outbox = await readJson(FILES.outbox, {});
    const list = outbox.ceremonies || [];
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) throw new Error(`no ceremony ${id}`);
    list[i] = op === 'update' ? { ...list[i], ...data } : { ...data, id };
    await writeJson(FILES.outbox, { ...outbox, ceremonies: list });
    return { [op]: path };
  }

  if (collection === 'recipients') {
    // A durable key generated in the browser. Recorded so `apply-env.mjs` can seal for it later;
    // the private half never leaves the tab it was made in.
    const dir = at('.secrets/recipients');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id.replace(/[^A-Za-z0-9_-]/g, '')}.json`), JSON.stringify(data, null, 2) + '\n');
    bump();
    return { recipient: id };
  }

  throw new Error(`collection ${collection} is not writable here`);
}

/* ------------------------------------------------------------------- running */

function run(command) {
  const argv = COMMANDS[command];
  if (!argv) return Promise.resolve({ ok: false, code: 2, output: `unknown command` });
  return new Promise((done) => {
    const child = spawn(process.execPath, argv, {
      cwd: repoRoot,
      // The ladder reaches providers; NODE_USE_ENV_PROXY matches what the npm scripts set.
      env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_OPTIONS: '' },
    });
    let output = '';
    const take = (chunk) => {
      output += chunk;
      // Bounded: a runaway command must not grow this process without limit.
      if (output.length > 200_000) output = output.slice(-200_000);
    };
    child.stdout.on('data', (c) => take(String(c)));
    child.stderr.on('data', (c) => take(String(c)));
    child.on('error', (err) => done({ ok: false, code: -1, output: `${output}\n${err.message}` }));
    child.on('close', (code) => { bump(); done({ ok: code === 0, code, output: output.trim() }); });
  });
}

/* -------------------------------------------------------------------- server */

/** The page, with the boot token injected. The file on disk stays a publishable artifact. */
async function pageHtml() {
  if (!existsSync(FILES.page)) return null;
  const html = await readFile(FILES.page, 'utf8');
  const inject = `<script>window.__SECRET_DROP__=${JSON.stringify({ token })};</script>\n`;
  const i = html.indexOf('<script>');
  return i < 0 ? inject + html : html.slice(0, i) + inject + html.slice(i);
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
};

/** Loopback only, and the boot token on every call: a page on another origin gets nothing. */
function authorised(req) {
  const host = (req.headers.host || '').split(':')[0];
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) return false;
  return req.headers['x-drop-token'] === token;
}

const readBody = (req) => new Promise((done, fail) => {
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 256_000) { fail(new Error('body too large')); req.destroy(); }
  });
  req.on('end', () => { try { done(raw ? JSON.parse(raw) : {}); } catch (e) { fail(e); } });
  req.on('error', fail);
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await pageHtml();
      if (!html) return json(res, 500, { error: 'No page built yet — run `npm run secrets:page`.' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }
    if (url.pathname.startsWith('/api/')) {
      if (!authorised(req)) return json(res, 403, { error: 'not authorised for this origin' });
      if (url.pathname === '/api/state' && req.method === 'GET') {
        return json(res, 200, { rev, collections: await collections() });
      }
      if (url.pathname === '/api/doc' && req.method === 'POST') {
        const { path, op, data } = await readBody(req);
        if (typeof path !== 'string' || !['set', 'update', 'delete'].includes(op)) return json(res, 400, { error: 'need { path, op }' });
        return json(res, 200, await writeDoc(path, op, data));
      }
      if (url.pathname === '/api/run' && req.method === 'POST') {
        const { command } = await readBody(req);
        console.log(`> ${command}`);
        return json(res, 200, await run(command));
      }
      return json(res, 404, { error: 'no such endpoint' });
    }
    return json(res, 404, { error: 'not found' });
  } catch (cause) {
    return json(res, 400, { error: cause?.message || String(cause) });
  }
});

/** Rebuild first, so the page always matches the registry the ladder will actually run. */
async function main() {
  const build = spawn(process.execPath, ['scripts/secrets/build-page.mjs'], { cwd: repoRoot, env: { ...process.env, NODE_OPTIONS: '' }, stdio: 'inherit' });
  await new Promise((done) => build.on('close', done));

  server.listen(port, '127.0.0.1', () => {
    const where = `http://127.0.0.1:${port}`;
    console.log(`\nSecret Drop is serving at ${where}`);
    console.log(`  store   .secrets/ (choices, handoffs, ceremonies, what has been applied)`);
    console.log(`  writes  ${envPath} — sealed in the browser, opened here, never printed`);
    if (!existsSync(FILES.privateKey) && !process.env.SECRETS_PRIVATE_KEY) {
      console.log('\n  No recipient key yet. Run `node scripts/secrets/keygen.mjs` so the page has');
      console.log('  something to seal for; until then values cannot be applied.');
    }
    console.log('\nCtrl-C to stop.\n');
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

export { collections, writeDoc, unseal, run, COMMANDS, FILES };
