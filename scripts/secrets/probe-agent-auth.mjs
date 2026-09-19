#!/usr/bin/env node
/**
 * Does this provider let an agent register itself? Ask it, don't assume.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/secrets/probe-agent-auth.mjs [--register] [host ...]
 *
 * This exists because a previous version of the registry asserted that "no provider supports
 * agent registration", having only looked for WorkOS's `agent_auth` extension at apex domains.
 * That was a category error: the mechanism the industry actually shipped is RFC 7591 dynamic
 * client registration behind RFC 9728/8414 metadata — which MCP's auth spec requires — and
 * Cloudflare, Neon, Supabase, Resend and Vercel all publish a working one.
 *
 * The probe checks, per endpoint:
 *   1. an unauthenticated MCP `initialize`, to read the WWW-Authenticate challenge
 *   2. /.well-known/oauth-protected-resource   (RFC 9728) → which authorization servers
 *   3. /.well-known/oauth-authorization-server (RFC 8414) → registration, authorize, device
 *   4. /auth.md and /.well-known/auth.md       (WorkOS's proposal, still worth reading)
 *
 * With --register it POSTs a real client registration, because an advertised endpoint is not
 * a working one: Uber publishes `registration_endpoint` and answers 403 "Missing csrf token".
 * Registration creates an unconsented public client that can reach nothing until a human
 * approves a scope, so it is safe — but it is a write, hence opt-in.
 */
const UA = process.env.ASSETS_USER_AGENT || 'sara-tyler-wedding-site/0.1 (agent-auth probe)';
const REDIRECT = process.env.SECRET_DROP_REDIRECT || 'http://127.0.0.1:8976/callback';
const args = process.argv.slice(2);
const doRegister = args.includes('--register');
const hosts = args.filter((a) => !a.startsWith('--'));

/** Endpoints worth asking. An MCP endpoint is the highest-signal one: its auth is specified. */
const DEFAULTS = [
  'https://bindings.mcp.cloudflare.com/sse',
  'https://mcp.neon.tech/sse',
  'https://mcp.supabase.com/mcp',
  'https://mcp.resend.com/sse',
  'https://api.vercel.com',
  'https://console.anthropic.com',
  'https://platform.openai.com',
  'https://api.duffel.com',
  'https://fal.ai',
  'https://auth.uber.com',
];

const req = async (url, init = {}) => {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json, text/markdown;q=0.9, */*;q=0.1', 'user-agent': UA, ...(init.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(15_000), ...init });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* HTML or markdown */ }
    return { status: res.status, json, text, auth: res.headers.get('www-authenticate') };
  } catch (e) { return { status: 0, error: e.message }; }
};

/** RFC 9728 → RFC 8414: follow the resource to its authorization server's metadata. */
async function discover(endpoint) {
  const u = new URL(endpoint);
  const base = u.origin;
  const path = u.pathname === '/' ? '' : u.pathname;
  const out = { endpoint, challenge: null, servers: [], meta: null, authmd: null };

  if (path) {
    const mcp = await req(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'secret-drop-probe', version: '1' } } }),
    });
    if (mcp.auth) out.challenge = mcp.auth;
  }

  for (const wk of [`${base}/.well-known/oauth-protected-resource${path}`, `${base}/.well-known/oauth-protected-resource`]) {
    const r = await req(wk);
    if (r.json?.authorization_servers?.length) { out.servers = r.json.authorization_servers; break; }
  }
  for (const server of [...out.servers, base]) {
    for (const wk of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
      for (const candidate of [server.replace(/\/+$/, '') + wk, server.replace(/\/+$/, '') + wk + path]) {
        const r = await req(candidate);
        if (r.json?.token_endpoint) { out.meta = r.json; out.metaUrl = candidate; break; }
      }
      if (out.meta) break;
    }
    if (out.meta) break;
  }
  for (const p of ['/auth.md', '/.well-known/auth.md']) {
    const r = await req(base + p);
    if (r.status === 200 && !/^\s*(<!doctype|<html)/i.test(r.text)) { out.authmd = base + p; break; }
  }
  return out;
}

/** An advertised registration endpoint is a claim; this is the test of it. */
async function tryRegister(endpoint) {
  const r = await req(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Secret Drop probe (unconsented, no scopes)',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (r.json?.client_id) return { ok: true, detail: 'registered' };
  return { ok: false, detail: `${r.status} ${String(r.json?.error || r.text || '').slice(0, 60).replace(/\s+/g, ' ')}` };
}

console.log('endpoint'.padEnd(42), 'agent registration'.padEnd(20), 'device'.padEnd(8), 'notes');
for (const endpoint of hosts.length ? hosts : DEFAULTS) {
  const d = await discover(endpoint);
  const reg = d.meta?.registration_endpoint;
  let verdict = reg ? 'advertised' : (d.meta ? 'no (oauth, no DCR)' : 'none published');
  if (reg && doRegister) {
    const t = await tryRegister(reg);
    verdict = t.ok ? 'WORKS' : `advertised, ${t.detail}`;
  }
  const notes = [
    d.challenge ? 'MCP challenge' : '',
    d.authmd ? 'auth.md doc' : '',
    d.meta?.scopes_supported ? `scopes: ${d.meta.scopes_supported.join(',')}` : '',
  ].filter(Boolean).join('; ');
  console.log(endpoint.replace(/^https:\/\//, '').padEnd(42), verdict.padEnd(20), (d.meta?.device_authorization_endpoint ? 'yes' : '-').padEnd(8), notes);
}
console.log('\nRe-run with --register to prove the advertised endpoints actually mint a client.');
