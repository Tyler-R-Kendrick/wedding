#!/usr/bin/env node
// Generate the sandbox "recipient" keypair for the Secret Drop page.
//   node scripts/secrets/keygen.mjs            → writes .secrets/private.jwk.json (0600) + .secrets/public.jwk.json
//   node scripts/secrets/keygen.mjs --print    → also prints the PUBLIC key JSON (safe to share/embed)
// The private key never leaves this machine and must never be printed, committed, or read by an agent.
// Envelope format: AES-256-GCM per value, key wrapped with RSA-OAEP (SHA-256, 4096-bit) per recipient.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const dir = new URL('../../.secrets/', import.meta.url);
const privPath = new URL('private.jwk.json', dir);
const pubPath = new URL('public.jwk.json', dir);
const print = process.argv.includes('--print');
const force = process.argv.includes('--force');

export function fingerprint(pubJwk) {
  // RFC 7638-style thumbprint over the required RSA members.
  const canon = JSON.stringify({ e: pubJwk.e, kty: pubJwk.kty, n: pubJwk.n });
  return createHash('sha256').update(canon).digest('base64url').slice(0, 16);
}

if (existsSync(privPath) && !force) {
  const pub = JSON.parse(await readFile(pubPath, 'utf8'));
  console.error(`Keypair already exists (id ${pub.kid}). Use --force to replace it (existing envelopes become undecryptable).`);
  if (print) console.log(JSON.stringify(pub));
  process.exit(0);
}

const pair = await subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['wrapKey', 'unwrapKey'],
);
const pub = await subtle.exportKey('jwk', pair.publicKey);
const priv = await subtle.exportKey('jwk', pair.privateKey);
const kid = fingerprint(pub);
const now = new Date().toISOString();
await mkdir(dir, { recursive: true });
await writeFile(privPath, JSON.stringify({ ...priv, kid, createdAt: now }), { mode: 0o600 });
await writeFile(pubPath, JSON.stringify({ kty: pub.kty, n: pub.n, e: pub.e, alg: 'RSA-OAEP-256', kid, createdAt: now, label: 'sandbox session key' }, null, 2) + '\n');
console.log(`Generated recipient key ${kid}. Private key: .secrets/private.jwk.json (mode 600, gitignored). Public key: .secrets/public.jwk.json`);
if (print) console.log(await readFile(pubPath, 'utf8'));
