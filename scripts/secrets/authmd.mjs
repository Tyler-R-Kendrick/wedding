#!/usr/bin/env node
/**
 * auth.md client — WorkOS's agentic-registration protocol (https://github.com/workos/auth.md).
 *
 * The point of auth.md is that the *agent* gets its own credential without a human
 * copying anything. Where a provider supports it, this is the top of our ladder.
 *
 *   discover(origin)  → RFC 9728 /.well-known/oauth-protected-resource, then RFC 8414
 *                       /.well-known/oauth-authorization-server, reading the `agent_auth`
 *                       extension; falls back to the /auth.md skill document.
 *   register(meta)    → POST identity_endpoint {type: anonymous | service_auth | identity_assertion}
 *   token(meta, a)    → POST token_endpoint  grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
 *   claim(meta, ...)  → device-code-style ceremony: the user opens one link and signs in,
 *                       we poll grant_type=urn:workos:agent-auth:grant-type:claim
 *
 * Nothing here prints a token. The CLI prints capability, not credentials:
 *   NODE_USE_ENV_PROXY=1 node scripts/secrets/authmd.mjs discover resend.com fal.ai
 */
import { SLOTS } from './registry.mjs';

const UA = process.env.ASSETS_USER_AGENT || 'sara-tyler-wedding-site/0.1 (secret-drop)';
const TIMEOUT = 12_000;

export const GRANT_JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const GRANT_CLAIM = 'urn:workos:agent-auth:grant-type:claim';

async function req(url, init = {}) {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { accept: 'application/json, text/markdown;q=0.9, */*;q=0.1', 'user-agent': UA, ...(init.headers || {}) },
      redirect: 'follow',
      signal: AbortSignal.timeout(init.timeout || TIMEOUT),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON; keep text */ }
    return { ok: res.ok, status: res.status, type: res.headers.get('content-type') || '', text, json };
  } catch (err) {
    return { ok: false, status: 0, type: '', text: '', json: null, error: err.message };
  }
}

const looksMarkdown = (r) =>
  r.status === 200 && !/^\s*(<!doctype html|<html)/i.test(r.text) &&
  (/text\/(markdown|plain)/.test(r.type) || /^#\s|^---\n/m.test(r.text));

/**
 * Find the agent_auth block for an origin. Returns
 * { origin, supported, agent_auth, token_endpoint, skill, identityTypes, doc }.
 */
export async function discover(origin) {
  const base = origin.startsWith('http') ? origin.replace(/\/+$/, '') : `https://${origin}`;
  const out = { origin: base, supported: false, agent_auth: null, token_endpoint: null, skill: null, identityTypes: [], doc: null, notes: [] };

  // RFC 9728: the resource points at its authorization servers.
  const servers = new Set([base]);
  const prm = await req(`${base}/.well-known/oauth-protected-resource`);
  if (prm.json?.authorization_servers) for (const s of prm.json.authorization_servers) servers.add(String(s).replace(/\/+$/, ''));

  for (const server of servers) {
    // RFC 8414 allows both the root and the path-suffixed form.
    for (const url of [`${server}/.well-known/oauth-authorization-server`, `${server}/.well-known/openid-configuration`]) {
      const meta = await req(url);
      if (!meta.json) continue;
      out.token_endpoint ||= meta.json.token_endpoint || null;
      if (meta.json.agent_auth) {
        out.supported = true;
        out.agent_auth = meta.json.agent_auth;
        out.identityTypes = meta.json.agent_auth.identity_types_supported || [];
        out.skill = meta.json.agent_auth.skill || null;
        out.token_endpoint = meta.json.token_endpoint || out.token_endpoint;
        return out;
      }
    }
  }

  // No metadata extension: a published skill document still tells us what is possible.
  for (const path of ['/auth.md', '/.well-known/auth.md']) {
    const doc = await req(`${base}${path}`);
    if (!looksMarkdown(doc)) continue;
    out.doc = `${base}${path}`;
    if (/does not support agentic registration|not support agent/i.test(doc.text)) {
      out.notes.push('auth.md states the provider does not support agentic registration');
    } else if (/anonymous/i.test(doc.text)) {
      out.notes.push('auth.md mentions anonymous identities but publishes no agent_auth metadata');
    }
    break;
  }
  return out;
}

/** POST identity_endpoint. `type` is one of anonymous | service_auth | identity_assertion. */
export async function register(meta, { type = 'anonymous', loginHint, assertion } = {}) {
  const endpoint = meta.agent_auth?.identity_endpoint;
  if (!endpoint) throw new Error(`${meta.origin} publishes no identity_endpoint`);
  if (!(meta.identityTypes.length === 0 || meta.identityTypes.includes(type))) {
    throw new Error(`${meta.origin} does not offer identity type "${type}" (offers ${meta.identityTypes.join(', ')})`);
  }
  const body = type === 'identity_assertion' ? { type, assertion }
    : type === 'service_auth' ? { type, login_hint: loginHint }
      : { type };
  const res = await req(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`identity registration failed (${res.status}) at ${endpoint}`);
  return res.json || {};
}

/** Exchange an identity assertion for an access token (JWT-bearer grant). */
export async function token(meta, assertion) {
  const endpoint = meta.token_endpoint;
  if (!endpoint) throw new Error(`${meta.origin} publishes no token_endpoint`);
  const res = await req(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: GRANT_JWT_BEARER, assertion }).toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  return res.json || {};
}

/**
 * The claim ceremony: the provider hands back a link for the user, we poll until they
 * finish. `onCeremony` is how the caller surfaces the link (we write it to the Secret
 * Drop page so it becomes a button, never a code to retype).
 */
export async function claim(meta, attempt, { onCeremony, intervalMs = 5000, timeoutMs = 600_000 } = {}) {
  const endpoint = meta.token_endpoint;
  const claimToken = attempt.claim_token || attempt.claim_attempt?.claim_token;
  const info = attempt.claim_attempt || attempt;
  if (!claimToken) throw new Error('provider returned no claim_token');
  if (onCeremony) {
    await onCeremony({
      kind: 'claim',
      verification_uri: info.verification_uri || null,
      verification_uri_complete: info.verification_uri_complete || info.verification_uri || null,
      user_code: info.user_code || null,
      expiresAt: new Date(Date.now() + (info.expires_in ? info.expires_in * 1000 : timeoutMs)).toISOString(),
    });
  }
  let wait = Math.max(intervalMs, (info.interval || 5) * 1000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait));
    const res = await req(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: GRANT_CLAIM, claim_token: claimToken }).toString(),
    });
    if (res.ok && res.json?.access_token) return res.json;
    const err = res.json?.error;
    if (err === 'authorization_pending') continue;
    if (err === 'slow_down') { wait += 5000; continue; }
    if (err) throw new Error(`claim failed: ${err}`);
  }
  throw new Error('claim ceremony timed out');
}

/**
 * The whole ladder rung: discover → register → token, escalating to a claim ceremony
 * only when the provider insists on one. Resolves { access_token, ... } or throws.
 */
export async function acquireToken(origin, { loginHint, onCeremony } = {}) {
  const meta = await discover(origin);
  if (!meta.supported) {
    const why = meta.notes[0] || 'no agent_auth metadata published';
    const err = new Error(`auth.md unavailable at ${meta.origin}: ${why}`);
    err.code = 'AUTHMD_UNSUPPORTED';
    throw err;
  }
  const type = meta.identityTypes.includes('anonymous') ? 'anonymous'
    : meta.identityTypes.includes('service_auth') ? 'service_auth' : meta.identityTypes[0];
  const identity = await register(meta, { type, loginHint });
  if (identity.access_token) return { ...identity, method: 'authmd', identityType: type };
  if (identity.identity_assertion) {
    const granted = await token(meta, identity.identity_assertion);
    if (granted.access_token) return { ...granted, method: 'authmd', identityType: type };
  }
  if (identity.claim_token || identity.claim_attempt) {
    const claimed = await claim(meta, identity, { onCeremony });
    return { ...claimed, method: 'authmd', identityType: type, claimed: true };
  }
  throw new Error(`${origin} registered an identity but issued no token`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'discover') {
    console.error('usage: authmd.mjs discover [origin ...]   (registration runs through acquire.mjs)');
    process.exit(2);
  }
  const origins = rest.length ? rest : [...new Set(
    SLOTS.flatMap((slot) => slot.options.flatMap((o) => o.ladder.filter((s) => s.method === 'authmd').map((s) => s.origin))).filter(Boolean),
  )];
  console.log('origin'.padEnd(34), 'agent_auth'.padEnd(11), 'identity types'.padEnd(38), 'notes');
  for (const origin of origins) {
    const meta = await discover(origin);
    console.log(
      meta.origin.replace(/^https:\/\//, '').padEnd(34),
      (meta.supported ? 'yes' : 'no').padEnd(11),
      (meta.identityTypes.join(', ') || '-').padEnd(38),
      [meta.doc ? `doc ${meta.doc.replace(meta.origin, '')}` : '', ...meta.notes].filter(Boolean).join('; '),
    );
  }
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
