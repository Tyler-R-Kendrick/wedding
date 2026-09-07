#!/usr/bin/env node
/**
 * The ladder runner. Given what Tyler & Sara want the site to *do*, get the credentials
 * for it — cheapest method first — and report what is still open.
 *
 *   node scripts/secrets/acquire.mjs plan --capability email,photos     what it would do
 *   node scripts/secrets/acquire.mjs run  --plan .secrets/plan.json     do it
 *   node scripts/secrets/acquire.mjs resume                             finish ceremonies the user has since approved
 *   node scripts/secrets/acquire.mjs report                             current state, names only
 *
 * The agent is the courier between this script and the Secret Drop page: it copies
 * `.secrets/outbox.json` into the page's store (so pending ceremonies become buttons)
 * and drops sealed OAuth codes into `.secrets/inbox/` (so `resume` can finish).
 * Values are decrypted and written to `.env` here, inside the sandbox, and are never
 * printed — output is names, methods and lengths.
 */
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { webcrypto, randomBytes } from 'node:crypto';
import { CREDENTIALS, AUTOFILL, METHOD_LABELS, NEED } from './registry.mjs';
import { applyEnv, readEnv, presentNames, describe } from './env-file.mjs';
import * as authmd from './authmd.mjs';
import * as oauth from './oauth.mjs';

const { subtle } = webcrypto;
const DIR = '.secrets';
const CEREMONIES = join(DIR, 'ceremonies.json');
const OUTBOX = join(DIR, 'outbox.json');
const INBOX = join(DIR, 'inbox');
const args = process.argv.slice(2);
const cmd = args[0] || 'report';
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);
const envPath = opt('env', '.env');

const byId = new Map(CREDENTIALS.map((c) => [c.id, c]));
const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
const writeJson = async (p, v) => { await mkdir(DIR, { recursive: true }); await writeFile(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 }); };
const rand = (n = 32) => randomBytes(n).toString('base64url');
const gitConfig = (key) => { try { return execFileSync('git', ['config', '--get', key], { encoding: 'utf8' }).trim(); } catch { return ''; } };

/* --------------------------------------------------------------------- plan */

/**
 * What to go and get. There is no question to ask: the registry already knows which
 * credentials this site needs, so the default plan is "everything that is not just tooling".
 * `--credential a,b` narrows it; `--all` adds the optional tooling too.
 *
 * An `alternateOf` group is satisfied by its first member — one embeddings provider is
 * enough, one travel provider is enough — so the ladder stops asking once one lands.
 */
export function resolvePlan({ credentials = [], all = false, alreadySet = new Set() } = {}) {
  if (credentials.length) {
    const named = [];
    for (const id of credentials) {
      const cred = byId.get(id);
      if (cred) named.push({ cred, why: 'asked for by name' });
    }
    return named;
  }
  const satisfied = new Set();
  for (const cred of CREDENTIALS) {
    if (cred.alternateOf && cred.vars.every((v) => alreadySet.has(v))) satisfied.add(cred.alternateOf);
  }
  const plan = [];
  for (const cred of CREDENTIALS) {
    if (cred.need === 'optional' && !all) continue;
    if (cred.alternateOf) {
      if (satisfied.has(cred.alternateOf)) continue;
      satisfied.add(cred.alternateOf); // take the first (cheapest ladder) member of the group
    }
    plan.push({ cred, why: NEED[cred.need] });
  }
  return plan;
}

/* ---------------------------------------------------------------- autofill */

/** Everything the sandbox can mint, derive or find. Never overwrites a set value. */
async function runAutofill({ dryRun }) {
  const text = await readEnv(envPath);
  const present = presentNames(text);
  const values = new Map();
  const resolved = new Map([...present].map((n) => [n, true]));
  for (const [name, spec] of Object.entries(AUTOFILL)) {
    if (present.has(name)) continue;
    let value = '';
    if (spec.method === 'generate') value = rand(spec.bytes);
    else if (spec.method === 'detect') value = spec.paths.find((p) => existsSync(p)) || '';
    else if (spec.method === 'derive') {
      if (spec.from) value = values.get(spec.from) || (resolved.has(spec.from) ? '' : '');
      else if (spec.git) value = gitConfig(spec.git);
      else value = spec.value || '';
      // A `from` that is already in .env is still a valid source.
      if (!value && spec.from) value = (await readEnv(envPath)).match(new RegExp(`^${spec.from}=(.*)$`, 'm'))?.[1] || spec.value || '';
    }
    if (value) values.set(name, value);
  }
  if (values.size && !dryRun) await applyEnv(values, { path: envPath, note: 'scripts/secrets/acquire.mjs (autofill)' });
  return [...values.keys()];
}

/* -------------------------------------------------------------- ceremonies */

async function putCeremony(credId, ceremony, extra = {}) {
  const all = await readJson(CEREMONIES, {});
  all[credId] = { ...ceremony, ...extra, credential: credId, status: 'waiting', startedAt: new Date().toISOString() };
  await writeJson(CEREMONIES, all);
  return all[credId];
}

/** Sealed OAuth codes the page produced; the agent drops them here as envelope JSON. */
async function readInboxCode(state) {
  if (!existsSync(INBOX)) return null;
  const priv = await loadPrivateKey();
  for (const file of (await readdir(INBOX)).filter((f) => f.endsWith('.json'))) {
    const path = join(INBOX, file);
    const doc = await readJson(path, null);
    const env = doc?.data ?? doc;
    if (!env?.ct || !env?.wrapped) continue;
    const plain = await openEnvelope(env, priv).catch(() => null);
    if (!plain) continue;
    let payload = null;
    try { payload = JSON.parse(plain); } catch { continue; }
    if (payload.state && state && payload.state !== state) continue;
    await rm(path, { force: true });
    return payload.code || null;
  }
  return null;
}

async function loadPrivateKey() {
  let jwk;
  if (process.env.SECRETS_PRIVATE_KEY) jwk = JSON.parse(Buffer.from(process.env.SECRETS_PRIVATE_KEY, 'base64url').toString('utf8'));
  else if (existsSync(join(DIR, 'private.jwk.json'))) jwk = JSON.parse(await readFile(join(DIR, 'private.jwk.json'), 'utf8'));
  else throw new Error('no private key: run scripts/secrets/keygen.mjs');
  const { kid, createdAt, ...pure } = jwk;
  return { key: await subtle.importKey('jwk', pure, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['unwrapKey']), kid };
}

async function openEnvelope(env, priv) {
  const ek = env.wrapped[priv.kid];
  if (!ek) throw new Error('envelope not sealed for this key');
  const aes = await subtle.unwrapKey('raw', Buffer.from(ek, 'base64url'), priv.key, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(env.iv, 'base64url'), additionalData: Buffer.from(env.name) }, aes, Buffer.from(env.ct, 'base64url'));
  return Buffer.from(pt).toString('utf8');
}

/* ------------------------------------------------------------ ladder rungs */

/** auth.md: the agent registers itself; a claim ceremony only if the provider insists. */
async function rungAuthmd(cred, step, ctx) {
  const result = await authmd.acquireToken(step.origin, {
    loginHint: ctx.adminEmail,
    onCeremony: (c) => putCeremony(cred.id, c, { method: 'authmd', provider: step.origin }),
  });
  const target = step.var || cred.vars[0];
  return { values: new Map([[target, result.access_token]]), method: 'authmd', detail: `identity type ${result.identityType}${result.claimed ? ', claimed by you' : ''}` };
}

/** A documented anonymous self-registration endpoint (Openverse's, today). */
async function rungRegister(cred, step, ctx) {
  const body = JSON.parse(JSON.stringify(step.body).replaceAll('{admin_email}', ctx.adminEmail || 'wedding-sandbox@example.invalid'));
  const res = await fetch(step.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': ctx.userAgent },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`self-registration returned ${res.status}${json.detail ? `: ${json.detail}` : ''}`);
  const values = new Map();
  for (const [name, field] of Object.entries(step.map)) if (json[field]) values.set(name, String(json[field]));
  if (!values.size) throw new Error('self-registration returned no credentials');
  return { values, method: 'register', detail: step.confirm || 'registered anonymously' };
}

/** Delegated: device grant if the provider has one, else a redirect this page catches. */
async function rungDelegated(cred, step, ctx) {
  const result = await oauth.delegate({
    origin: step.origin,
    authorizeEndpoint: step.authorize,
    tokenEndpoint: step.token,
    scope: step.scope,
    redirectUri: ctx.redirectUri,
    onCeremony: (c) => putCeremony(cred.id, c, { method: c.kind === 'device' ? 'device' : 'oauth', provider: step.origin, scope: step.scope || null }),
    awaitCode: ctx.waitSeconds
      ? async (state) => {
        const deadline = Date.now() + ctx.waitSeconds * 1000;
        while (Date.now() < deadline) {
          const code = await readInboxCode(state);
          if (code) return code;
          await new Promise((r) => setTimeout(r, 3000));
        }
        const err = new Error('waiting for you to approve the link');
        err.code = 'CEREMONY_PENDING';
        throw err;
      }
      : async () => { const err = new Error('waiting for you to approve the link'); err.code = 'CEREMONY_PENDING'; throw err; },
  });
  const target = step.var || cred.vars[0];
  return { values: new Map([[target, result.access_token]]), method: result.method, detail: 'delegated authorization' };
}

/** The agent holds the MCP tools, so this rung is reported for it to perform, not run here. */
function rungMcp(cred, step) {
  const err = new Error(`needs the ${step.server} MCP server: ${step.how}`);
  err.code = 'AGENT_TASK';
  err.task = { credential: cred.id, server: step.server, how: step.how, vars: cred.vars, warn: cred.warn || null };
  throw err;
}

/** Drive Chromium against a dashboard the user has authorized. */
async function rungBrowser(cred, step, ctx) {
  const { capture } = await import('./browser-capture.mjs');
  return capture(cred, step, ctx);
}

const RUNGS = { authmd: rungAuthmd, register: rungRegister, device: rungDelegated, oauth: rungDelegated, mcp: rungMcp, browser: rungBrowser };

/* -------------------------------------------------------------------- run */

async function runLadder(entry, ctx) {
  const { cred } = entry;
  const attempts = [];
  for (const step of cred.ladder) {
    const rung = RUNGS[step.method];
    if (!rung) { attempts.push({ method: step.method, outcome: step.method === 'manual' ? 'left to you' : 'not implemented' }); continue; }
    try {
      const result = await rung(cred, step, ctx);
      return { credential: cred.id, state: 'acquired', ...result, attempts };
    } catch (err) {
      attempts.push({ method: step.method, outcome: err.message });
      if (err.code === 'CEREMONY_PENDING') return { credential: cred.id, state: 'waiting-on-you', method: step.method, attempts };
      if (err.code === 'AGENT_TASK') { attempts[attempts.length - 1].task = err.task; continue; }
    }
  }
  return { credential: cred.id, state: 'open', attempts };
}

async function commandRun({ dryRun }) {
  const autofilled = await runAutofill({ dryRun });
  const envText = await readEnv(envPath);
  const already = presentNames(envText);
  const plan = resolvePlan({
    credentials: (opt('credential', '')).split(',').filter(Boolean),
    all: flag('all'),
    alreadySet: already,
  });
  // The Secret Drop page is the OAuth redirect target: its URL lives in .secrets/page.json,
  // written by build-page.mjs, so a redeploy to a new artifact URL updates the ceremonies too.
  const page = await readJson(join(DIR, 'page.json'), {});
  const ctx = {
    adminEmail: (envText.match(/^ADMIN_EMAILS=(.*)$/m)?.[1] || gitConfig('user.email') || '').split(',')[0].trim(),
    userAgent: envText.match(/^ASSETS_USER_AGENT=(.*)$/m)?.[1] || 'sara-tyler-wedding-site/0.1',
    redirectUri: opt('redirect', page.url || null),
    waitSeconds: Number(opt('wait', 0)) || 0,
    tokens: await readJson(join(DIR, 'tokens.json'), {}),
  };

  const results = [];
  for (const entry of plan) {
    if (entry.cred.vars.every((v) => already.has(v))) { results.push({ credential: entry.cred.id, state: 'already-set', attempts: [] }); continue; }
    const result = await runLadder(entry, ctx);
    if (result.values?.size && !dryRun) {
      const applied = await applyEnv(result.values, { path: envPath, note: `scripts/secrets/acquire.mjs (${result.method})` });
      result.wrote = describe(result.values);
      result.applied = applied;
      delete result.values;
    } else if (result.values) { result.wrote = describe(result.values); delete result.values; }
    results.push(result);
  }
  await writeOutbox({ autofilled, results });
  report({ autofilled, results });
  return results;
}

/** Finish anything the user has approved since the last run. */
async function commandResume() {
  const ceremonies = await readJson(CEREMONIES, {});
  const results = [];
  for (const [credId, ceremony] of Object.entries(ceremonies)) {
    if (ceremony.status === 'done') continue;
    const cred = byId.get(credId);
    if (!cred) continue;
    const code = await readInboxCode(ceremony.state);
    if (!code) { results.push({ credential: credId, state: 'waiting-on-you', method: ceremony.method }); continue; }
    try {
      const step = cred.ladder.find((s) => s.method === 'oauth') || {};
      const granted = await oauth.exchangeCode({
        tokenEndpoint: step.token || ceremony.token_endpoint,
        clientId: ceremony.client_id, clientSecret: ceremony.client_secret,
        redirectUri: ceremony.redirectUri, code, verifier: ceremony.verifier,
      });
      const values = new Map([[step.var || cred.vars[0], granted.access_token]]);
      await applyEnv(values, { path: envPath, note: 'scripts/secrets/acquire.mjs (oauth)' });
      ceremonies[credId] = { ...ceremony, status: 'done', finishedAt: new Date().toISOString() };
      results.push({ credential: credId, state: 'acquired', method: 'oauth', wrote: describe(values) });
    } catch (err) {
      results.push({ credential: credId, state: 'failed', method: ceremony.method, attempts: [{ method: ceremony.method, outcome: err.message }] });
    }
  }
  await writeJson(CEREMONIES, ceremonies);
  await writeOutbox({ autofilled: [], results });
  report({ autofilled: [], results });
}

/* ----------------------------------------------------------------- report */

/** The file the agent mirrors into the page's store: ceremonies to click, status chips. */
async function writeOutbox({ autofilled, results }) {
  const ceremonies = await readJson(CEREMONIES, {});
  const present = presentNames(await readEnv(envPath));
  const status = {};
  for (const cred of CREDENTIALS) {
    const r = results.find((x) => x.credential === cred.id);
    const set = cred.vars.filter((v) => present.has(v));
    status[cred.id] = {
      credential: cred.id,
      vars: cred.vars,
      set: set.length,
      of: cred.vars.length,
      state: r?.state || (set.length === cred.vars.length ? 'already-set' : 'queued'),
      method: r?.method || null,
      detail: r?.detail || r?.attempts?.map((a) => `${a.method}: ${a.outcome}`).join(' · ') || null,
      at: new Date().toISOString(),
    };
  }
  const pending = Object.values(ceremonies)
    .filter((c) => c.status !== 'done' && new Date(c.expiresAt || 0).getTime() > Date.now())
    .map(({ device_code, verifier, client_secret, ...safe }) => safe); // never mirror the secret half
  const tasks = results.flatMap((r) => (r.attempts || []).filter((a) => a.task).map((a) => a.task));
  await writeJson(OUTBOX, { format: 'secret-drop/plan-1', updatedAt: new Date().toISOString(), autofilled, status, ceremonies: pending, agentTasks: tasks });
}

function report({ autofilled, results }) {
  if (autofilled.length) console.log(`Auto-filled (no account needed): ${autofilled.join(', ')}`);
  for (const r of results) {
    const label = METHOD_LABELS[r.method]?.short || r.method || '';
    const head = `${r.credential.padEnd(20)} ${r.state}${label ? ` via ${label}` : ''}`;
    console.log(head);
    if (r.wrote) console.log(`  wrote ${r.wrote.join(', ')}`);
    if (r.detail) console.log(`  ${r.detail}`);
    for (const a of r.attempts || []) if (!r.wrote) console.log(`  ${a.method}: ${a.outcome}`);
  }
  console.log(`\nPage payload: ${OUTBOX} — mirror it into the Secret Drop store so pending links become buttons.`);
}

async function commandPlan() {
  const already = presentNames(await readEnv(envPath));
  const plan = resolvePlan({
    credentials: (opt('credential', '')).split(',').filter(Boolean),
    all: flag('all'),
    alreadySet: already,
  });
  console.log('credential'.padEnd(20), 'need'.padEnd(9), 'best method'.padEnd(12), 'you do'.padEnd(24), 'unlocks');
  for (const { cred } of plan) {
    const m = cred.ladder[0].method;
    console.log(cred.id.padEnd(20), (cred.need || '').padEnd(9), m.padEnd(12), (METHOD_LABELS[m]?.human || '').padEnd(24), cred.unlocks);
  }
  console.log(`\n${plan.filter((p) => ['device', 'oauth', 'browser'].includes(p.cred.ladder[0].method)).length} of these can need a click from you; the rest are the sandbox's job.`);
}

// Only dispatch when run as a command; `resolvePlan` is imported by the page build and tests,
// and importing a module must never write files or exit the process.
if (import.meta.url === `file://${process.argv[1]}`) {
  switch (cmd) {
    case 'plan': await commandPlan(); break;
    case 'run': await commandRun({ dryRun: flag('dry-run') }); break;
    case 'resume': await commandResume(); break;
    case 'report': await writeOutbox({ autofilled: [], results: [] }).then(async () => console.log(await readFile(OUTBOX, 'utf8'))); break;
    default: console.error('usage: acquire.mjs plan|run|resume|report [--credential x,y] [--all] [--wait 300] [--dry-run]'); process.exit(2);
  }
}
