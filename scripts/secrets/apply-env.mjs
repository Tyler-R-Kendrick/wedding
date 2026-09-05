#!/usr/bin/env node
// Decrypt Secret Drop envelopes into .env without ever printing a value.
//   node scripts/secrets/apply-env.mjs <envelopes.json | dir-of-json>   [--env .env] [--dry-run]
// Private key: .secrets/private.jwk.json, or SECRETS_PRIVATE_KEY (base64url JSON JWK) for CI/session-start.
// Envelope doc shape (written by the page): { name, alg: "A256GCM+RSA-OAEP-256", iv, ct, wrapped: { <kid>: <ek> }, createdAt }
// All binary fields are base64url. Output: only variable names and lengths.
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);
const source = args.find((a) => !a.startsWith('--') && !['.env', opt('env', '.env')].includes(a));
const envPath = opt('env', '.env');
if (!source) { console.error('usage: apply-env.mjs <envelopes.json | directory> [--env .env] [--dry-run]'); process.exit(2); }

const b64u = { dec: (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64') };

async function loadPrivateKey() {
  let jwk;
  if (process.env.SECRETS_PRIVATE_KEY) jwk = JSON.parse(b64u.dec(process.env.SECRETS_PRIVATE_KEY).toString('utf8'));
  else if (existsSync('.secrets/private.jwk.json')) jwk = JSON.parse(await readFile('.secrets/private.jwk.json', 'utf8'));
  else { console.error('No private key: set SECRETS_PRIVATE_KEY or run scripts/secrets/keygen.mjs'); process.exit(2); }
  const { kid, createdAt, ...pure } = jwk;
  const key = await subtle.importKey('jwk', pure, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['unwrapKey']);
  return { key, kid };
}

async function loadEnvelopes(src) {
  const s = await stat(src);
  const files = s.isDirectory() ? (await readdir(src)).filter((f) => f.endsWith('.json')).map((f) => join(src, f)) : [src];
  const out = [];
  for (const f of files) {
    const j = JSON.parse(await readFile(f, 'utf8'));
    const list = Array.isArray(j) ? j : Array.isArray(j.envelopes) ? j.envelopes : j.data ? [j.data] : [j];
    for (const e of list) if (e && e.name && e.ct && e.wrapped) out.push(e);
  }
  return out;
}

async function open(env, priv) {
  const ek = env.wrapped[priv.kid];
  if (!ek) return { name: env.name, error: `no envelope for key ${priv.kid} (has ${Object.keys(env.wrapped).join(', ')})` };
  try {
    const aes = await subtle.unwrapKey('raw', b64u.dec(ek), priv.key, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(env.iv), additionalData: Buffer.from(env.name) }, aes, b64u.dec(env.ct));
    return { name: env.name, value: Buffer.from(pt).toString('utf8') };
  } catch {
    return { name: env.name, error: 'decryption failed (wrong key or corrupted envelope)' };
  }
}

const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
function quote(v) { return /^[A-Za-z0-9_./:@+=,-]*$/.test(v) ? v : JSON.stringify(v); }

function mergeEnv(existing, entries) {
  const lines = existing ? existing.split('\n') : [];
  const seen = new Set();
  const out = lines.map((line) => {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (!m) return line;
    const e = entries.get(m[1]);
    if (!e) return line;
    seen.add(m[1]);
    return `${m[1]}=${quote(e)}`;
  });
  const added = [...entries.keys()].filter((k) => !seen.has(k));
  if (added.length) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push(`# added by scripts/secrets/apply-env.mjs ${new Date().toISOString()}`); for (const k of added) out.push(`${k}=${quote(entries.get(k))}`); }
  return { text: out.join('\n').replace(/\n*$/, '\n'), updated: [...seen], added };
}

const priv = await loadPrivateKey();
const envelopes = await loadEnvelopes(source);
if (!envelopes.length) { console.error('No envelopes found in', source); process.exit(1); }
const entries = new Map(); const errors = [];
for (const e of envelopes) {
  if (!NAME_RE.test(e.name)) { errors.push(`${e.name}: invalid variable name`); continue; }
  const r = await open(e, priv);
  if (r.error) errors.push(`${r.name}: ${r.error}`); else entries.set(r.name, r.value);
}
if (flag('dry-run')) { console.log(`Would apply ${entries.size} variable(s): ${[...entries.keys()].join(', ')}`); }
else if (entries.size) {
  const existing = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
  const { text, updated, added } = mergeEnv(existing, entries);
  await writeFile(envPath, text, { mode: 0o600 });
  console.log(`Applied to ${envPath}: ${entries.size} variable(s). updated=[${updated.join(', ')}] added=[${added.join(', ')}]`);
  for (const [k, v] of entries) console.log(`  ${k}  (${v.length} chars)`);
}
if (errors.length) { console.error('Problems:\n  ' + errors.join('\n  ')); process.exit(entries.size ? 0 : 1); }
