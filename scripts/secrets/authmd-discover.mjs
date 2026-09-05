#!/usr/bin/env node
// Discover which providers publish an auth.md (WorkOS's open agent-registration protocol,
// https://github.com/workos/auth.md) and whether they allow anonymous self-registration.
//   NODE_USE_ENV_PROXY=1 node scripts/secrets/authmd-discover.mjs [host ...]
// Read-only: it fetches /auth.md, /.well-known/auth.md and /.well-known/oauth-authorization-server
// and prints a table. Registration itself is a deliberate follow-up step (see docs/ops/secrets.md).
const DEFAULT_HOSTS = [
  'fal.ai', 'higgsfield.ai', 'resend.com', 'api.openverse.org', 'stitch.withgoogle.com', 'duffel.com',
  'developers.skyscanner.net', 'developers.booking.com', 'developer.uber.com', 'voyageai.com', 'openai.com',
  'anthropic.com', 'supabase.com', 'vercel.com', 'cloudflare.com', 'workos.com',
];
const hosts = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_HOSTS;
const get = async (url) => {
  try {
    const res = await fetch(url, { headers: { accept: 'text/markdown, application/json, text/plain;q=0.9, */*;q=0.1', 'user-agent': process.env.ASSETS_USER_AGENT || 'sara-tyler-wedding-site/0.1' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    const text = await res.text();
    return { status: res.status, type: res.headers.get('content-type') || '', text };
  } catch (e) { return { status: 0, type: '', text: '', error: e.message }; }
};
const isMarkdown = (r) => r.status === 200 && !/^\s*<!doctype html|<html/i.test(r.text) && (/text\/(markdown|plain)/.test(r.type) || /^#\s|^---\n/m.test(r.text));
console.log('host'.padEnd(28), 'auth.md'.padEnd(10), 'metadata'.padEnd(10), 'anonymous?'.padEnd(12), 'notes');
for (const host of hosts) {
  const md = (await get(`https://${host}/auth.md`));
  const md2 = isMarkdown(md) ? md : await get(`https://${host}/.well-known/auth.md`);
  const meta = await get(`https://${host}/.well-known/oauth-authorization-server`);
  let anonymous = '-', notes = '';
  let metaOk = false;
  if (meta.status === 200) { try { const j = JSON.parse(meta.text); metaOk = !!j.agent_auth; if (metaOk) { anonymous = (j.agent_auth.identity_types_supported || []).includes('anonymous') ? 'yes' : 'no'; notes = `identity=${j.agent_auth.identity_endpoint || '?'}`; } } catch {} }
  const doc = isMarkdown(md) ? md : (isMarkdown(md2) ? md2 : null);
  if (doc) {
    if (/does not support agentic registration|not support agent/i.test(doc.text)) { anonymous = anonymous === '-' ? 'no' : anonymous; notes += (notes ? '; ' : '') + 'auth.md says: no agentic registration'; }
    else if (/anonymous/i.test(doc.text) && anonymous === '-') anonymous = 'maybe (read auth.md)';
  }
  console.log(host.padEnd(28), (doc ? 'yes' : 'no').padEnd(10), (metaOk ? 'yes' : 'no').padEnd(10), anonymous.padEnd(12), notes);
}
