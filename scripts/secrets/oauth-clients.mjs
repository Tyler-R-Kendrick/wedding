/**
 * OAuth clients for the Secret Drop page, registered where a browser cannot.
 *
 * The published page has no server, and that fact was read far too broadly: because a provider's
 * `/oauth/register` and `/oauth/token` answer without `access-control-allow-origin`, the page was
 * treated as unable to run the ceremony at all, and every such provider was demoted to filing a
 * request that told the reader to open a terminal. Resend is the clearest example — it mints a
 * client for an agent with no human involved, and the page still offered "Get the link".
 *
 * Only two of the three OAuth steps ever needed CORS:
 *
 *   discovery + registration   a `fetch` whose reply must be read   -> CORS, so: done here, at
 *                                                                     build time, in Node
 *   authorization              a top-level navigation               -> no CORS, so: the browser
 *   token exchange             a `fetch` whose reply must be read   -> CORS, so: the browser only
 *                                                                     where the provider allows it
 *
 * So the client is registered once, from here, and its id is baked into the page. That id is not
 * a secret: these are public clients (`token_endpoint_auth_method: 'none'`), the id travels in
 * every authorization URL, and it is readable in the published page either way — which is why the
 * cache is committed rather than kept under `.secrets/`.
 *
 * What must never be here is a client *secret*, and two different providers make that a real
 * risk rather than a theoretical one. Supabase issues only confidential clients, so it is refused
 * before it is even registered; Neon agrees to a public client and returns a secret anyway, which
 * is dropped on the floor. Either way `register()` returns an id or nothing.
 *
 * The cache is also what makes this build offline-safe and deterministic: a build with every
 * client already known makes no network call at all, so CI builds the same page as a laptop.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Committed on purpose — see above. Public client ids, keyed by issuer and redirect URI. */
export const CLIENTS_PATH = fileURLToPath(new URL('./oauth-clients.json', import.meta.url));

const UA = 'secret-drop/1 (+https://github.com/Tyler-R-Kendrick/wedding)';
const TIMEOUT_MS = 15_000;

const req = async (url, init = {}) => {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA, ...(init.headers || {}) },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON: an HTML error page, usually */ }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
};

/** RFC 9728 -> RFC 8414, the same two hops the sandbox and the page both make. */
export async function discover(origin) {
  const base = origin.replace(/\/+$/, '');
  const direct = await req(base + '/.well-known/oauth-authorization-server');
  if (direct.json?.token_endpoint) return direct.json;
  const prm = await req(base + '/.well-known/oauth-protected-resource');
  const server = prm.json?.authorization_servers?.[0];
  if (!server) return null;
  const meta = await req(server.replace(/\/+$/, '') + '/.well-known/oauth-authorization-server');
  return meta.json?.token_endpoint ? meta.json : null;
}

/**
 * Register one public client, negotiating against what the server says it supports.
 *
 * Asking for a grant the issuer does not list is how an earlier pass got refusals it read as
 * "no agent auth here": the endpoint was fine, the request was not.
 */
export async function register(meta, redirectUri, { scope, name } = {}) {
  if (!meta?.registration_endpoint) return null;
  // A provider that cannot issue a PUBLIC client cannot be used from a page at all: the exchange
  // would need a client secret, and a secret baked into a published artifact is a secret given
  // away. Supabase is exactly this — it offers only `client_secret_basic`/`client_secret_post` —
  // so it is skipped here rather than registered and then refused below.
  const authMethods = meta.token_endpoint_auth_methods_supported;
  if (Array.isArray(authMethods) && !authMethods.includes('none')) return null;

  const supported = Array.isArray(meta.grant_types_supported) ? meta.grant_types_supported : null;
  const wanted = ['authorization_code', 'refresh_token'];
  const grants = supported ? wanted.filter((g) => supported.includes(g)) : wanted;
  if (!grants.includes('authorization_code')) return null;

  // Only ask for scopes the issuer publishes; an unknown scope is a refusal at some providers.
  const offered = typeof meta.scopes_supported?.join === 'function' ? meta.scopes_supported : null;
  const asked = (scope || '').split(/\s+/).filter(Boolean);
  const scopes = offered ? asked.filter((s) => offered.includes(s)) : asked;

  const res = await req(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: name || 'Sara + Tyler wedding Secret Drop',
      redirect_uris: [redirectUri],
      grant_types: grants,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(scopes.length ? { scope: scopes.join(' ') } : {}),
    }),
  });
  if (!res.ok || !res.json?.client_id) return null;
  // Some providers hand back a `client_secret` even for a client they have agreed is public —
  // Neon does, while echoing `token_endpoint_auth_method: "none"`. That secret is not needed for
  // the exchange and is never stored or returned. What is refused is the other case: a secret
  // together with an auth method that actually requires it, which is a confidential client, and
  // no part of it may reach a committed file or the published page.
  if (res.json.client_secret && (res.json.token_endpoint_auth_method || 'client_secret_basic') !== 'none') return null;
  return {
    clientId: res.json.client_id,
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    scope: scopes.join(' ') || null,
    registeredAt: new Date().toISOString(),
  };
}

export async function loadClients(path = CLIENTS_PATH) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return {}; }
}

export async function saveClients(clients, path = CLIENTS_PATH) {
  const sorted = Object.fromEntries(Object.entries(clients).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path, JSON.stringify(sorted, null, 2) + '\n');
}

/** One client is one issuer at one redirect URI: a client registered for another URI cannot be used. */
export const keyOf = (origin, redirectUri) => `${origin.replace(/\/+$/, '')}|${redirectUri}`;

/**
 * Make sure every `link` option that can have a client has one, and return the map to bake in.
 *
 * Never throws and never fails a build: a provider that is unreachable, publishes nothing, or
 * refuses simply has no client, and the page falls back to asking for that one option. `offline`
 * skips the network entirely and uses only what is cached.
 */
export async function ensureClients(registry, redirectUri, { offline = false, log = () => {} } = {}) {
  const clients = await loadClients();
  if (!redirectUri) return { clients, added: 0, missing: [] };

  const wanted = [];
  for (const slot of registry.slots) {
    for (const option of slot.options) {
      if (option.ceremony !== 'link' || !option.oauth?.origin) continue;
      wanted.push({ slot: slot.id, option });
    }
  }

  let added = 0;
  const missing = [];
  for (const { slot, option } of wanted) {
    const key = keyOf(option.oauth.origin, redirectUri);
    if (clients[key]?.clientId) continue;
    if (offline) { missing.push(`${slot}/${option.id}`); continue; }
    const meta = await discover(option.oauth.origin);
    const client = meta ? await register(meta, redirectUri, { scope: option.oauth.scope }) : null;
    if (client) { clients[key] = client; added += 1; log(`registered ${option.name} (${option.oauth.origin})`); }
    else { missing.push(`${slot}/${option.id}`); log(`no client for ${option.name} (${option.oauth.origin})`); }
  }
  if (added) await saveClients(clients);
  return { clients, added, missing };
}

/**
 * Hang each option's client (or null) on it, in place — the shape the page reads.
 *
 * Both the build and the tests go through here, so a test can never pass against a registry the
 * published page does not actually have.
 */
export async function attachClients(registry, redirectUri, clients = null) {
  const map = clients || await loadClients();
  let withClient = 0;
  for (const slot of registry.slots) {
    for (const option of slot.options) {
      const client = clientFor(option, redirectUri, map);
      option.oauthClient = client
        ? {
          clientId: client.clientId,
          authorizationEndpoint: client.authorizationEndpoint,
          tokenEndpoint: client.tokenEndpoint,
          scope: client.scope || null,
          redirectUri,
        }
        : null;
      if (option.oauthClient) withClient += 1;
    }
  }
  return withClient;
}

/** The client for one option, or null — the shape the page reads off each option. */
export function clientFor(option, redirectUri, clients) {
  if (!option?.oauth?.origin || !redirectUri) return null;
  return clients?.[keyOf(option.oauth.origin, redirectUri)] || null;
}
