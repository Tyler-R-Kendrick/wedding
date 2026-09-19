#!/usr/bin/env node
/**
 * Delegated ceremonies — the fallback when auth.md is not on offer.
 *
 * The rule this file exists to serve: never make a human copy a secret. Where the
 * provider supports it we run the RFC 8628 device grant (one link, we poll). Where it
 * only speaks authorization-code, the Secret Drop page itself is the redirect target:
 * the browser lands back on the page with `?code=`, the page seals the code with the
 * sandbox's public key, and we exchange it here with the PKCE verifier that never left
 * the sandbox. Either way what crosses the human's screen is a link, not a credential.
 *
 *   metadata(origin)                RFC 8414 discovery
 *   registerClient(meta, opts)      RFC 7591 dynamic client registration
 *   deviceStart / devicePoll        RFC 8628
 *   pkce / authorizeUrl / exchange  RFC 7636 + 6749 authorization code
 */
import { webcrypto, randomBytes } from 'node:crypto';

const { subtle } = webcrypto;
const UA = process.env.ASSETS_USER_AGENT || 'sara-tyler-wedding-site/0.1 (secret-drop)';
const b64u = (buf) => Buffer.from(buf).toString('base64url');

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'user-agent': UA, ...headers },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* form-encoded error bodies exist in the wild */ }
  if (!json && text.includes('=')) json = Object.fromEntries(new URLSearchParams(text));
  return { ok: res.ok, status: res.status, json: json || {} };
}
const form = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v != null)).toString();

const WELL_KNOWN = ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'];

async function fetchJson(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(12_000) });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      // These endpoints rate-limit; one retry separates "busy" from "absent".
      if (i + 1 < tries) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return null;
}

/**
 * Discovery, the whole chain: RFC 9728 protected-resource metadata names the authorization
 * servers, and each is described by RFC 8414 metadata. Trying only the resource's own origin
 * misses every provider that separates the two — Supabase's MCP endpoint points at
 * api.supabase.com, and looking only at mcp.supabase.com finds nothing.
 */
export async function metadata(origin) {
  const u = new URL(origin.startsWith('http') ? origin : `https://${origin}`);
  const base = u.origin;
  const path = u.pathname === '/' ? '' : u.pathname;

  const servers = [];
  for (const wk of [`${base}/.well-known/oauth-protected-resource${path}`, `${base}/.well-known/oauth-protected-resource`]) {
    const prm = await fetchJson(wk);
    if (prm?.authorization_servers?.length) { servers.push(...prm.authorization_servers.map((x) => String(x).replace(/\/+$/, ''))); break; }
  }
  if (!servers.includes(base)) servers.push(base);

  for (const server of servers) {
    for (const wk of WELL_KNOWN) {
      for (const candidate of path ? [server + wk, server + wk + path] : [server + wk]) {
        const json = await fetchJson(candidate);
        if (json?.token_endpoint) return json;
      }
    }
  }
  return null;
}

/** RFC 7591: ask the provider to mint us a client. Many providers allow this anonymously. */
/**
 * RFC 7591. Ask only for grants the server says it supports: requesting the device grant from
 * a server that does not offer it is a 400, which is how this failed against Cloudflare and
 * Resend even though both register happily when asked properly.
 */
/**
 * @param {{registration_endpoint?: string, grant_types_supported?: string[]}} meta
 * @param {{redirectUri?: string, name?: string, grantTypes?: string[]}} [options]
 * @returns {Promise<{client_id: string, client_secret?: string}>}
 */
export async function registerClient(meta, { redirectUri, name = 'Sara + Tyler wedding sandbox', grantTypes } = {}) {
  if (!meta?.registration_endpoint) {
    const err = new Error('provider publishes no registration_endpoint');
    err.code = 'NO_DCR';
    throw err;
  }
  const supported = new Set(meta.grant_types_supported || ['authorization_code', 'refresh_token']);
  const wanted = (grantTypes || ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code']).filter((g) => supported.has(g));
  const body = {
    client_name: name,
    redirect_uris: redirectUri ? [redirectUri] : undefined,
    grant_types: wanted.length ? wanted : ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
  // `application_type: native` is for loopback/custom-scheme clients; an https redirect is a web client.
  if (redirectUri && !/^https:/.test(redirectUri)) body.application_type = 'native';
  const res = await post(meta.registration_endpoint, JSON.stringify(body), { 'content-type': 'application/json' });
  if (!res.ok || !res.json.client_id) {
    throw new Error(`dynamic client registration failed (${res.status})${res.json?.error_description ? ': ' + res.json.error_description : ''}`);
  }
  return res.json;
}

/* ------------------------------------------------------------------ device grant */

/** RFC 8628 step 1. Returns the ceremony: a link for the human, a code for us. */
export async function deviceStart({ endpoint, clientId, scope }) {
  if (!endpoint) { const e = new Error('provider publishes no device_authorization_endpoint'); e.code = 'NO_DEVICE'; throw e; }
  const res = await post(endpoint, form({ client_id: clientId, scope }), { 'content-type': 'application/x-www-form-urlencoded' });
  if (!res.ok || !res.json.device_code) throw new Error(`device authorization failed (${res.status}): ${res.json.error || 'no device_code'}`);
  const d = res.json;
  return {
    kind: 'device',
    device_code: d.device_code,
    user_code: d.user_code || null,
    verification_uri: d.verification_uri || d.verification_url || null,
    // The "complete" form embeds the code so the user only ever clicks.
    verification_uri_complete: d.verification_uri_complete || d.verification_url_complete
      || (d.verification_uri && d.user_code ? `${d.verification_uri}?user_code=${encodeURIComponent(d.user_code)}` : null),
    interval: d.interval || 5,
    expiresAt: new Date(Date.now() + (d.expires_in || 900) * 1000).toISOString(),
  };
}

/** RFC 8628 step 2: poll, honouring authorization_pending / slow_down. */
export async function devicePoll({ tokenEndpoint, clientId, ceremony, signal }) {
  let wait = (ceremony.interval || 5) * 1000;
  const deadline = new Date(ceremony.expiresAt).getTime();
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('cancelled');
    await new Promise((r) => setTimeout(r, wait));
    const res = await post(tokenEndpoint, form({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: ceremony.device_code,
      client_id: clientId,
    }), { 'content-type': 'application/x-www-form-urlencoded' });
    if (res.ok && res.json.access_token) return res.json;
    const err = res.json.error;
    if (err === 'authorization_pending') continue;
    if (err === 'slow_down') { wait += 5000; continue; }
    if (err === 'access_denied') throw new Error('you declined the authorization');
    if (err) throw new Error(`device grant failed: ${err}`);
  }
  throw new Error('the authorization link expired');
}

/* ------------------------------------------------- authorization code + PKCE */

/** A fresh PKCE pair. The verifier stays in the sandbox; only the challenge travels. */
export async function pkce() {
  const verifier = b64u(randomBytes(64));
  const challenge = b64u(await subtle.digest('SHA-256', Buffer.from(verifier)));
  return { verifier, challenge, method: 'S256' };
}

/** Build the link the human clicks. `redirectUri` is the Secret Drop page. */
export function authorizeUrl({ endpoint, clientId, redirectUri, scope, state, challenge, extra = {} }) {
  const url = new URL(endpoint);
  for (const [k, v] of Object.entries({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope,
    state, code_challenge: challenge, code_challenge_method: 'S256', ...extra,
  })) if (v != null) url.searchParams.set(k, v);
  return url.toString();
}

/** Trade the code the page sealed for a token. */
export async function exchangeCode({ tokenEndpoint, clientId, clientSecret, redirectUri, code, verifier }) {
  const res = await post(tokenEndpoint, form({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    client_id: clientId, client_secret: clientSecret, code_verifier: verifier,
  }), { 'content-type': 'application/x-www-form-urlencoded' });
  if (!res.ok || !res.json.access_token) throw new Error(`code exchange failed (${res.status}): ${res.json.error || 'no access_token'}`);
  return res.json;
}

/**
 * Whole-ceremony helper: prefer the device grant, fall back to a redirect the page
 * catches. `onCeremony` publishes the link; `awaitCode` resolves once the page has
 * sealed a code for us (acquire.mjs supplies both).
 */
export async function delegate({ origin, clientId, clientSecret, scope, redirectUri, onCeremony, awaitCode, authorizeEndpoint, tokenEndpoint }) {
  // Some servers refuse an https redirect they have not approved (Vercel) and want a loopback.
  const meta = await metadata(origin);
  const token_endpoint = tokenEndpoint || meta?.token_endpoint;
  if (!token_endpoint) throw new Error(`no token endpoint discoverable at ${origin}`);

  let client = clientId;
  if (!client && meta?.registration_endpoint) {
    const registered = await registerClient(meta, { redirectUri });
    client = registered.client_id;
    clientSecret = registered.client_secret || clientSecret;
  }
  if (!client) { const e = new Error(`${origin} needs a client_id and offers no dynamic registration`); e.code = 'NO_CLIENT'; throw e; }

  if (meta?.device_authorization_endpoint) {
    const ceremony = await deviceStart({ endpoint: meta.device_authorization_endpoint, clientId: client, scope });
    await onCeremony?.(ceremony);
    return { ...(await devicePoll({ tokenEndpoint: token_endpoint, clientId: client, ceremony })), method: 'device' };
  }

  const authorize_endpoint = authorizeEndpoint || meta?.authorization_endpoint;
  if (!authorize_endpoint || !awaitCode) { const e = new Error(`${origin} supports neither the device grant nor a catchable redirect`); e.code = 'NO_CEREMONY'; throw e; }
  const { verifier, challenge } = await pkce();
  const state = b64u(randomBytes(16));
  const url = authorizeUrl({ endpoint: authorize_endpoint, clientId: client, redirectUri, scope, state, challenge });
  await onCeremony?.({ kind: 'oauth', authorize_url: url, verification_uri_complete: url, state, redirectUri, expiresAt: new Date(Date.now() + 900_000).toISOString() });
  const code = await awaitCode(state);
  return { ...(await exchangeCode({ tokenEndpoint: token_endpoint, clientId: client, clientSecret, redirectUri, code, verifier })), method: 'oauth' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const origins = process.argv.slice(2);
  if (!origins.length) { console.error('usage: oauth.mjs <origin ...>   — reports which delegated ceremonies each origin supports'); process.exit(2); }
  console.log('origin'.padEnd(30), 'device'.padEnd(8), 'authcode'.padEnd(10), 'dyn-reg'.padEnd(9), 'token endpoint');
  for (const origin of origins) {
    const meta = await metadata(origin);
    console.log(
      origin.replace(/^https?:\/\//, '').padEnd(30),
      (meta?.device_authorization_endpoint ? 'yes' : 'no').padEnd(8),
      (meta?.authorization_endpoint ? 'yes' : 'no').padEnd(10),
      (meta?.registration_endpoint ? 'yes' : 'no').padEnd(9),
      meta?.token_endpoint || '-',
    );
  }
}
