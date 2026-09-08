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

/** Names the page seals a redirect code under; `takeCode()` in the page mints them. */
const OAUTH_CODE_RE = /^OAUTH_CODE_[A-Z0-9_]+$/;

const { subtle } = webcrypto;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const at = (...p) => join(repoRoot, ...p);

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', process.env.SECRET_DROP_PORT || 4600));
const envPath = opt('env', '.env');
/**
 * Where the store lives. Overridable so a check can run against fixtures it controls rather than
 * whatever this sandbox happens to hold — the page verification passed once only because the real
 * store had no ceremonies in it that day.
 */
const secretsDir = opt('secrets', '.secrets');
// `resolve`, not `join`: an absolute --secrets path must not be pasted onto the repo root, which
// silently pointed the store at a directory that did not exist and served empty collections.
const inStore = (name) => resolve(repoRoot, secretsDir, name);

/**
 * The environment every spawned job gets.
 *
 * `--secrets` used to bind only this server: the ladder it spawned still read and wrote the
 * developer's real `.secrets/`, so a check pointed at a fixture directory quietly mutated the real
 * store and then judged the fixture. NODE_USE_ENV_PROXY matches what the npm scripts set.
 */
const jobEnv = () => ({
  ...process.env,
  SECRETS_DIR: resolve(repoRoot, secretsDir),
  SECRET_DROP_ENV: envPath,
  NODE_USE_ENV_PROXY: '1',
  NODE_OPTIONS: '',
});

/** Files the page's collections are projected from. Nothing else on disk is reachable. */
const FILES = {
  outbox: inStore('outbox.json'),
  choices: inStore('choices.json'),
  handoffs: inStore('handoffs.json'),
  ceremonies: inStore('ceremonies.json'),
  applied: inStore('applied.json'),
  publicKey: inStore('public.jwk.json'),
  privateKey: inStore('private.jwk.json'),
  page: inStore('secret-drop.html'),
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
    // An OAuth code is not a variable. Writing it into .env put a JSON blob under a name nothing
    // reads and left the ceremony saying "finishing up" for ever; `resume` is what finishes it.
    if (OAUTH_CODE_RE.test(data?.name || id)) return startExchange(data?.name || id, { ...data, name: data?.name || id });
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
    // A hand-off is a request for work, so do the work. Not awaited: the page gets its answer
    // immediately and watches the record move through running -> done | failed.
    if (collection === 'handoffs' && op !== 'delete' && all[id]?.status === 'requested') {
      startHandoff(id, all[id]);
    }
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
    const dir = inStore('recipients');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id.replace(/[^A-Za-z0-9_-]/g, '')}.json`), JSON.stringify(data, null, 2) + '\n');
    bump();
    return { recipient: id };
  }

  throw new Error(`collection ${collection} is not writable here`);
}

/* --------------------------------------------------------------- hand-offs */

/**
 * What a hand-off actually runs. Named work, never a string from the request.
 *
 * Before this existed the page wrote `handoffs/<slot>` and *nothing read it*: one writer,
 * zero consumers. Pressing "Sign in once" said "Claude is on it" and then sat there for ever,
 * because nobody was on it. A button that reports dispatched work must dispatch work.
 */
const HANDOFF_WORK = {
  // The recipe id, not the host. `relay` resolves an id or a recipe's exact host, and an option's
  // host is the brand domain (postmarkapp.com) while the recipe drives account.postmarkapp.com —
  // so sending the host dispatched work that could only ever answer "unknown provider".
  signin: (h) => {
    const target = h.recipe || h.host;
    return target ? ['scripts/secrets/browser-capture.mjs', 'relay', target] : null;
  },
  link: (h) => ['scripts/secrets/acquire.mjs', 'run', '--slot', h.slot],
};

/** One job per key; the map is also how a second press knows not to start a duplicate. */
const running = new Map();

/** Anything that looks like a credential never reaches the log the page can read. */
const redact = (text) => String(text)
  .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
  .replace(/\b(sk|pk|re|key|tok)[-_][A-Za-z0-9_-]{8,}\b/gi, '[redacted]');

/**
 * The part of a job's output a person can act on.
 *
 * The last three lines of stdout are usually a V8 stack: `at Module._compile (node:internal/...)`
 * tells nobody anything about why signing in to Postmark failed. Prefer the thrown message, then
 * the last line that is not a stack frame, and only then give up and say how it exited.
 */
function explain(log, code) {
  const lines = String(log).split('\n').map((l) => l.trim()).filter(Boolean);
  const frame = /^(at\s|node:internal|\s*\^|Node\.js v)/;
  const thrown = [...lines].reverse().find((l) => /^(Uncaught\s)?\w*Error:\s*\S/.test(l));
  if (thrown) return thrown.replace(/^(Uncaught\s)?\w*Error:\s*/, '');
  const said = [...lines].reverse().find((l) => !frame.test(l));
  if (said) return said;
  return code === 0 ? 'finished' : `exited ${code}`;
}

async function patchHandoff(slot, patch) {
  const all = await readJson(FILES.handoffs, {});
  if (!all[slot]) return null;
  all[slot] = { ...all[slot], ...patch };
  await writeJson(FILES.handoffs, all);
  return all[slot];
}

/**
 * The same, for a ceremony — which the page reads from the outbox but the ladder owns.
 *
 * Both copies, deliberately. The outbox list is what the page renders, but `acquire.mjs` rebuilds
 * that list from `ceremonies.json` every time it writes an outbox, so patching only the outbox
 * meant the exchange's progress was erased by the very run that produced it.
 */
async function patchCeremony(id, patch) {
  const owned = await readJson(FILES.ceremonies, {});
  const key = Object.keys(owned).find((k) => k === id || owned[k]?.id === id);
  if (key) {
    owned[key] = { ...owned[key], ...patch };
    await writeJson(FILES.ceremonies, owned);
  }
  const outbox = await readJson(FILES.outbox, {});
  const list = outbox.ceremonies || [];
  const i = list.findIndex((c) => c.id === id || c.credential === id);
  if (i >= 0) {
    list[i] = { ...list[i], ...patch };
    await writeJson(FILES.outbox, { ...outbox, ceremonies: list });
  }
  return (key || i >= 0) ? { ...patch, id } : null;
}

/**
 * Run a job and record what happens to it, so the page can show progress and an outcome instead
 * of a sentence that never changes. Every dispatched thing goes through here: states are
 * running -> done | failed, and the log tail is redacted before the page can read it.
 */
function runJob(key, argv, { patch, label, startField = 'startedAt' }) {
  if (running.has(key)) return;

  const child = spawn(process.execPath, argv, { cwd: repoRoot, env: jobEnv() });
  running.set(key, child);
  void patch({ status: 'running', [startField]: new Date().toISOString(), detail: null, log: '' });
  console.log(`> ${label} (${argv.slice(1).join(' ')})`);

  let log = '';
  const take = (chunk) => {
    log = redact(log + chunk).slice(-8000);
    // The page polls the store, so progress is whatever the last lines say.
    void patch({ log, progressAt: new Date().toISOString() });
  };
  child.stdout.on('data', (c) => take(String(c)));
  child.stderr.on('data', (c) => take(String(c)));
  child.on('error', (err) => {
    running.delete(key);
    void patch({ status: 'failed', finishedAt: new Date().toISOString(), detail: redact(err.message) });
  });
  child.on('close', (code) => {
    running.delete(key);
    void patch({
      status: code === 0 ? 'done' : 'failed',
      finishedAt: new Date().toISOString(),
      exitCode: code,
      detail: explain(log, code),
    });
    console.log(`  ${label}: ${code === 0 ? 'done' : `failed (${code})`}`);
  });
}

/** A hand-off the page asked for: pick the named work, or say plainly that there is none. */
function startHandoff(slot, handoff) {
  const argv = HANDOFF_WORK[handoff.kind]?.(handoff);
  if (!argv) {
    void patchHandoff(slot, {
      status: 'failed', finishedAt: new Date().toISOString(),
      detail: `nothing here knows how to do a "${handoff.kind}" hand-off for ${slot}`,
    });
    return;
  }
  runJob(slot, argv, { patch: (p) => patchHandoff(slot, p), label: `handoff ${slot}: ${handoff.kind}` });
}

/**
 * An OAuth code came back. Exchange it.
 *
 * This is the hand-off bug in its other costume: the page wrote `status: 'code-received'` and
 * rendered "Approved — finishing up", and nothing anywhere read that status, so the exchange
 * never happened and the sentence never changed. `acquire.mjs resume` is what finishes it, and
 * it reads sealed codes out of `.secrets/inbox/` — so that is where the envelope goes, still
 * sealed, instead of being written into `.env` under a name that is not a variable.
 */
async function startExchange(name, envelope) {
  const inbox = inStore('inbox');
  await mkdir(inbox, { recursive: true, mode: 0o700 });
  await writeFile(join(inbox, `${name}.json`), JSON.stringify(envelope, null, 2) + '\n', { mode: 0o600 });
  const outbox = await readJson(FILES.outbox, {});
  // The ceremony this code belongs to, by the slot the page named when it sealed it.
  const slot = name.replace(/^OAUTH_CODE_/, '').toLowerCase().replace(/_/g, '-');
  const ceremony = (outbox.ceremonies || []).find((c) => c.credential === slot || c.id === slot);
  const id = ceremony?.id || slot;
  await patchCeremony(id, { status: 'code-received', receivedAt: new Date().toISOString() });
  runJob(`ceremony:${id}`, ['scripts/secrets/acquire.mjs', 'resume'], {
    patch: (p) => patchCeremony(id, p),
    label: `exchange ${id}`,
    startField: 'exchangeStartedAt',
  });
  return { queued: id };
}

/**
 * A job cannot survive the process that spawned it. Anything still marked `running` at boot
 * belongs to a server that is gone, and leaving it there is the same lie in a new form.
 */
async function reapAbandonedJobs() {
  const stale = (r) => ({ ...r, status: 'failed', finishedAt: new Date().toISOString(), detail: 'the server stopped before this finished' });

  const all = await readJson(FILES.handoffs, {});
  let changed = false;
  for (const [slot, h] of Object.entries(all)) {
    if (h?.status === 'running') { all[slot] = stale(h); changed = true; }
  }
  if (changed) await writeJson(FILES.handoffs, all);

  const midExchange = (c) => c?.status === 'exchanging' || c?.status === 'running';

  const outbox = await readJson(FILES.outbox, {});
  const list = outbox.ceremonies || [];
  let ceremoniesChanged = false;
  for (const [i, c] of list.entries()) {
    if (midExchange(c)) { list[i] = stale(c); ceremoniesChanged = true; }
  }
  if (ceremoniesChanged) await writeJson(FILES.outbox, { ...outbox, ceremonies: list });

  // The ladder's own copy too, or `writeOutbox` mirrors the dead state straight back.
  const owned = await readJson(FILES.ceremonies, {});
  let ownedChanged = false;
  for (const [id, c] of Object.entries(owned)) {
    if (midExchange(c)) { owned[id] = stale(c); ownedChanged = true; }
  }
  if (ownedChanged) await writeJson(FILES.ceremonies, owned);
}

/* ------------------------------------------------------------------- running */

function run(command) {
  const argv = COMMANDS[command];
  if (!argv) return Promise.resolve({ ok: false, code: 2, output: `unknown command` });
  return new Promise((done) => {
    const child = spawn(process.execPath, argv, { cwd: repoRoot, env: jobEnv() });
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
  const build = spawn(process.execPath, ['scripts/secrets/build-page.mjs'], { cwd: repoRoot, env: jobEnv(), stdio: 'inherit' });
  await new Promise((done) => build.on('close', done));
  await reapAbandonedJobs();
  // "The server stopped before this finished" has to be true of the job as well as the record:
  // an orphaned Chromium keeps a provider session open with nobody watching it.
  const stopJobs = () => { for (const child of running.values()) { try { child.kill('SIGTERM'); } catch { /* already gone */ } } };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopJobs(); process.exit(0); });
  process.on('exit', stopJobs);

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

export { collections, writeDoc, unseal, run, COMMANDS, FILES, HANDOFF_WORK, OAUTH_CODE_RE, redact, explain };
