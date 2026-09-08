#!/usr/bin/env node
/**
 * Render the Secret Drop page from the template plus this sandbox's public key and the
 * live credential registry, so the page can never describe a ladder the sandbox does not run.
 *
 *   node scripts/secrets/build-page.mjs                      → .secrets/secret-drop.html
 *   node scripts/secrets/build-page.mjs --url https://…      → also records the artifact URL,
 *                                                              which is the OAuth redirect target
 *
 * Rebuild and republish whenever the registry changes or a new sandbox generates a keypair
 * (the baked key is what the browser seals for; a stale one leaves envelopes only a dead
 * sandbox could open — the durable recipient in the page's store is the safety net).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { clientRegistry } from './registry.mjs';
import { STORE, inStore } from './store.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const out = opt('out', inStore('secret-drop.html'));
const templatePath = new URL('./page/template.html', import.meta.url);

const template = await readFile(templatePath, 'utf8');
let sandboxKey = null;
if (existsSync(inStore('public.jwk.json'))) {
  const jwk = JSON.parse(await readFile(inStore('public.jwk.json'), 'utf8'));
  sandboxKey = { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RSA-OAEP-256', kid: jwk.kid, label: jwk.label || 'sandbox session key', createdAt: jwk.createdAt };
} else {
  console.error('No .secrets/public.jwk.json — run scripts/secrets/keygen.mjs first, or the page will have nothing to seal for.');
}

const registry = clientRegistry();

// The page is one self-contained file with no build step at runtime, so the decision logic is
// inlined rather than imported. It is written as an ES module because the tests import it; the
// only transform needed is dropping the `export` keywords.
const logic = (await readFile(new URL('./page/logic.mjs', import.meta.url), 'utf8'))
  .replace(/^export (function|const|class)/gm, '$1');

const html = template
  .replace('/*__REGISTRY__*/ null', JSON.stringify(registry))
  .replace('/*__SANDBOX_KEY__*/ null', JSON.stringify(sandboxKey))
  .replace('/*__LOGIC__*/', logic);

if (html.includes('__LOGIC__') || html.includes('createLogic') === false) {
  console.error('Page logic did not inline — check scripts/secrets/page/logic.mjs and the /*__LOGIC__*/ placeholder.');
  process.exit(1);
}

if (html.includes('__REGISTRY__') || html.includes('__SANDBOX_KEY__')) {
  console.error('Template placeholders did not substitute — check scripts/secrets/page/template.html');
  process.exit(1);
}

await mkdir(STORE, { recursive: true });
await writeFile(out, html);

const pageMeta = existsSync(inStore('page.json')) ? JSON.parse(await readFile(inStore('page.json'), 'utf8')) : {};
const url = opt('url', pageMeta.url || null);
await writeFile(inStore('page.json'), JSON.stringify({ url, builtAt: new Date().toISOString(), key: sandboxKey?.kid || null, slots: registry.slots.length, options: registry.slots.reduce((n, s) => n + s.options.length, 0) }, null, 2) + '\n');

console.log(`Built ${out} (${(html.length / 1024).toFixed(1)} KB) for key ${sandboxKey?.kid || '(none)'} — ${registry.slots.length} slots, ${registry.slots.reduce((n, s) => n + s.options.length, 0)} provider options.`);
console.log(url ? `Redirect target for delegated OAuth: ${url}` : 'No artifact URL recorded yet — pass --url after publishing so OAuth redirects come back to the page.');
