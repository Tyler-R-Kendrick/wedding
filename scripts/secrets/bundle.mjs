#!/usr/bin/env node
// Combine envelope JSON files (as saved by `read_db … out_dir`) into one committed-safe bundle.
//   node scripts/secrets/bundle.mjs <dir-of-json> [--out .secrets/env.enc.json]
// The bundle holds ciphertext only. Commit it so future sessions with SECRETS_PRIVATE_KEY can
// self-apply at session start (see docs/ops/secrets.md).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : '.secrets/env.enc.json';
if (!dir) { console.error('usage: bundle.mjs <dir> [--out file]'); process.exit(2); }
const envelopes = [];
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
  const j = JSON.parse(await readFile(join(dir, f), 'utf8'));
  const e = j.data ?? j;
  if (e && e.name && e.ct && e.wrapped) envelopes.push({ name: e.name, alg: e.alg, iv: e.iv, ct: e.ct, wrapped: e.wrapped, createdAt: e.createdAt });
}
envelopes.sort((a, b) => a.name.localeCompare(b.name));
let existing = [];
try { existing = JSON.parse(await readFile(out, 'utf8')).envelopes ?? []; } catch {}
const byName = new Map(existing.map((e) => [e.name, e]));
for (const e of envelopes) byName.set(e.name, e);
await writeFile(out, JSON.stringify({ format: 'secret-drop/1', updatedAt: new Date().toISOString(), envelopes: [...byName.values()] }, null, 2) + '\n');
console.log(`Bundled ${envelopes.length} envelope(s) into ${out} (${byName.size} total): ${[...byName.keys()].join(', ')}`);
