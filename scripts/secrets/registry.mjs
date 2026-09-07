#!/usr/bin/env node
/**
 * The credential registry: for every variable the app can use, how the sandbox is
 * supposed to GET it — cheapest, least human-involving method first.
 *
 * This file is the single source of truth for three consumers:
 *   - scripts/secrets/acquire.mjs   runs the ladder
 *   - scripts/secrets/verify.mjs    probes what landed
 *   - scripts/secrets/build-page.mjs  bakes `clientRegistry()` into the Secret Drop page
 * so the page can never drift from what the sandbox will actually do.
 *
 * Everything here is data (no closures), so it serializes to the browser unchanged.
 *
 * METHODS, in ladder order — the first that works wins:
 *   generate  random material minted in the sandbox (no account exists to ask)
 *   derive    computed from another value, the repo, or git config
 *   detect    found on this machine (binaries, paths)
 *   mcp       a connected MCP server provisions it (Supabase, Vercel, Cloudflare, fal)
 *   authmd    auth.md agent registration — WorkOS's protocol, probed live per host
 *   register  a documented anonymous self-registration endpoint (no auth.md needed)
 *   device    RFC 8628 device authorization: user opens one link, agent polls
 *   oauth     authorization code + PKCE; the artifact page receives the redirect
 *   browser   agent drives Chromium against a dashboard the user just authorized
 *   manual    the last resort: a human pastes a value
 *
 * `input` says what the page asks of Tyler & Sara:
 *   none      never shown a field (the sandbox always produces it)
 *   override  handled automatically; a field exists only to force a value
 *   apply     no key can be minted at all — a partner application, so a field is right
 */

/** Ladder rank; lower is preferred. Used to sort and to label "best available". */
export const METHOD_RANK = {
  generate: 0, derive: 1, detect: 2, mcp: 3, authmd: 4, register: 5,
  device: 6, oauth: 7, browser: 8, manual: 9,
};

/** How each method reads in the UI and in the agent's report. */
export const METHOD_LABELS = {
  generate: { short: 'generated', page: 'Generated in the sandbox', human: 'nothing to do' },
  derive: { short: 'derived', page: 'Derived from what is already set', human: 'nothing to do' },
  detect: { short: 'detected', page: 'Detected on this machine', human: 'nothing to do' },
  mcp: { short: 'provisioned', page: 'Provisioned through a connected MCP server', human: 'nothing to do' },
  authmd: { short: 'auth.md', page: 'Agent registers itself (auth.md)', human: 'one click, only if the provider asks you to claim it' },
  register: { short: 'registered', page: 'Agent self-registers with the provider', human: 'nothing to do' },
  device: { short: 'device link', page: 'You open one link and approve', human: 'one click' },
  oauth: { short: 'OAuth link', page: 'You open one link and approve', human: 'one click' },
  browser: { short: 'browser', page: 'You authorize, then the agent reads the dashboard', human: 'one sign-in' },
  manual: { short: 'paste', page: 'Paste it yourself', human: 'copy and paste' },
};

/**
 * Self-generable material. `bytes` mints base64url randomness; `value` is a literal;
 * `from` copies another variable; `detect` takes the first path that exists.
 */
export const AUTOFILL = {
  CONFIRMATION_SECRET: { method: 'generate', bytes: 32, why: 'HMAC for confirmation tokens' },
  CRON_SECRET: { method: 'generate', bytes: 32, why: 'bearer for POST /api/jobs/run' },
  BETTER_AUTH_SECRET: { method: 'generate', bytes: 32, why: 'Better Auth session signing' },
  TEST_AUTH_SECRET: { method: 'generate', bytes: 24, why: 'test-only principal injector' },
  DEV_STORAGE_SECRET: { method: 'generate', bytes: 32, why: 'HMAC for local signed storage URLs' },
  STORAGE_SIGNING_SECRET: { method: 'generate', bytes: 32, why: 'HMAC for local-fs storage URLs (production name)' },
  AUDIT_HASH_KEY: { method: 'generate', bytes: 32, why: 'HMAC for audit input fingerprints' },
  DEV_INBOX_TOKEN: { method: 'generate', bytes: 24, why: 'bearer for the dev inbox outside localhost' },
  HEALTH_TOKEN: { method: 'generate', bytes: 24, why: 'bearer for provider details on /api/health' },
  TRANSPORT_SECRETS_KEY: { method: 'generate', bytes: 32, why: 'seals unclaimed ride codes at rest' },
  DUFFEL_WEBHOOK_SECRET: { method: 'generate', bytes: 32, why: 'signature secret we hand to Duffel' },
  NEXT_PUBLIC_SITE_URL: { method: 'derive', value: 'http://localhost:3000', why: 'local origin' },
  BETTER_AUTH_URL: { method: 'derive', from: 'NEXT_PUBLIC_SITE_URL', why: 'same origin as the site' },
  EMAIL_FROM: { method: 'derive', value: 'Sara + Tyler <no-reply@localhost>', why: 'dev inbox sender' },
  S3_REGION: { method: 'derive', value: 'auto', why: 'R2 and most S3 clones accept `auto`' },
  ADMIN_EMAILS: { method: 'derive', git: 'user.email', why: 'the git identity in this sandbox is an admin' },
  PW_CHROMIUM_PATH: { method: 'detect', paths: ['/opt/pw-browsers/chromium', '/usr/bin/chromium'], why: 'preinstalled Chromium' },
  FFMPEG_PATH: { method: 'detect', paths: ['/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux', '/usr/bin/ffmpeg'], why: 'ffmpeg for video posters' },
  ASSETS_USER_AGENT: {
    method: 'derive', value: 'sara-tyler-wedding-site/0.1 (+https://github.com/Tyler-R-Kendrick/wedding)',
    why: 'identifies our scripts to Wikimedia/Openverse',
  },
};

/**
 * One credential = one account-bound thing to obtain, and the variables it fills.
 * `ladder` is tried in order. Anything not obtainable falls through to `manual`,
 * which acquire.mjs never performs — it only reports it as still open.
 */
export const CREDENTIALS = [
  {
    need: 'launch', id: 'anthropic', title: 'Anthropic API key', vars: ['ANTHROPIC_API_KEY'],
    unlocks: 'Concierge chat, the RSVP verifier, and photo captions',
    without: 'the app runs the ai/test mock model',
    host: 'console.anthropic.com', dashboard: 'https://console.anthropic.com/settings/keys',
    ladder: [
      { method: 'authmd', origin: 'https://console.anthropic.com' },
      { method: 'browser', recipe: 'anthropic-console' },
      { method: 'manual' },
    ],
    probe: { url: 'https://api.anthropic.com/v1/models?limit=1', headers: { 'x-api-key': '{value}', 'anthropic-version': '2023-06-01' } },
  },
  {
    need: 'feature', alternateOf: 'embeddings', id: 'openai', title: 'OpenAI API key', vars: ['OPENAI_API_KEY'],
    unlocks: 'Text embeddings for photo and story search',
    without: 'a hashed 256-dim mock embedding (search still works, worse)',
    host: 'platform.openai.com', dashboard: 'https://platform.openai.com/api-keys',
    ladder: [
      { method: 'authmd', origin: 'https://platform.openai.com' },
      { method: 'browser', recipe: 'openai-platform' },
      { method: 'manual' },
    ],
    probe: { url: 'https://api.openai.com/v1/models', headers: { authorization: 'Bearer {value}' } },
  },
  {
    need: 'feature', alternateOf: 'embeddings', id: 'voyage', title: 'Voyage AI key', vars: ['VOYAGE_API_KEY'],
    unlocks: 'Embeddings (the alternative to OpenAI; better recall per dollar)',
    without: 'the same hashed mock embedding',
    host: 'dashboard.voyageai.com', dashboard: 'https://dashboard.voyageai.com/api-keys',
    ladder: [
      { method: 'authmd', origin: 'https://www.voyageai.com' },
      { method: 'browser', recipe: 'voyage-dashboard' },
      { method: 'manual' },
    ],
    probe: { url: 'https://api.voyageai.com/v1/embeddings', method: 'POST', headers: { authorization: 'Bearer {value}', 'content-type': 'application/json' }, body: '{"input":["ping"],"model":"voyage-3-lite"}' },
  },
  {
    need: 'launch', id: 'resend', title: 'Resend API key', vars: ['RESEND_API_KEY'],
    unlocks: 'Real one-time-code e-mails to guests',
    without: 'codes land in the dev inbox at /api/dev/inbox',
    host: 'resend.com', dashboard: 'https://resend.com/api-keys',
    note: 'Resend publishes auth.md but declines agentic registration; the ladder still probes it each run in case that changes.',
    ladder: [
      { method: 'authmd', origin: 'https://resend.com' },
      { method: 'browser', recipe: 'resend-dashboard' },
      { method: 'manual' },
    ],
    probe: { url: 'https://api.resend.com/domains', headers: { authorization: 'Bearer {value}' } },
  },
  {
    need: 'feature', id: 'database', title: 'Postgres database', vars: ['DATABASE_URL'],
    unlocks: 'A real database that survives the sandbox',
    without: 'embedded PGlite under ./.data/pglite (fine for development)',
    host: 'supabase.com', dashboard: 'https://supabase.com/dashboard',
    ladder: [
      { method: 'mcp', server: 'Supabase', how: 'create_project then get the pooled connection string' },
      { method: 'browser', recipe: 'supabase-dashboard' },
      { method: 'manual' },
    ],
    warn: 'A connection string returned through chat has passed the transcript: rotate the database password before real guest data exists.',
  },
  {
    need: 'optional', id: 'openverse', title: 'Openverse client', vars: ['OPENVERSE_CLIENT_ID', 'OPENVERSE_CLIENT_SECRET'],
    unlocks: 'Higher rate limits when fetching openly licensed placeholder imagery',
    without: 'anonymous Openverse access, which is rate limited',
    host: 'api.openverse.org',
    ladder: [
      {
        method: 'register',
        url: 'https://api.openverse.org/v1/auth_tokens/register/',
        body: { name: 'sara-tyler-wedding-site', description: 'Placeholder imagery for a private wedding website', email: '{admin_email}' },
        map: { OPENVERSE_CLIENT_ID: 'client_id', OPENVERSE_CLIENT_SECRET: 'client_secret' },
        confirm: 'Openverse e-mails a verification link; the key works at the anonymous rate limit until it is clicked.',
      },
      { method: 'manual' },
    ],
  },
  {
    need: 'optional', id: 'fal', title: 'fal.ai key', vars: ['FAL_KEY'],
    unlocks: 'Mood boards, textures and comps from scripts/fal-generate.mjs',
    without: 'the licensed placeholder set already committed under public/',
    host: 'fal.ai', dashboard: 'https://fal.ai/dashboard/keys',
    ladder: [
      { method: 'authmd', origin: 'https://fal.ai' },
      { method: 'browser', recipe: 'fal-dashboard' },
      { method: 'manual' },
    ],
    probe: { url: 'https://rest.alpha.fal.ai/tokens/', method: 'GET', headers: { authorization: 'Key {value}' } },
  },
  {
    need: 'optional', id: 'stitch', title: 'Google Stitch key', vars: ['STITCH_API_KEY'],
    unlocks: 'The optional Stitch comp generator and taste-design comparison',
    without: 'impeccable alone drives the comps',
    host: 'stitch.withgoogle.com', dashboard: 'https://stitch.withgoogle.com',
    ladder: [
      { method: 'authmd', origin: 'https://stitch.withgoogle.com' },
      { method: 'manual' },
    ],
  },
  {
    need: 'launch', id: 'storage', title: 'S3-compatible bucket', vars: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
    unlocks: 'Guest photo and video uploads that outlive the sandbox',
    without: 'local-fs storage under ./.data/storage',
    host: 'dash.cloudflare.com', dashboard: 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens',
    ladder: [
      { method: 'mcp', server: 'Cloudflare Developer Platform', how: 'create an R2 bucket and a scoped token' },
      { method: 'browser', recipe: 'cloudflare-r2' },
      { method: 'manual' },
    ],
  },
  {
    need: 'feature', id: 'cloudflare-stream', title: 'Cloudflare Stream', vars: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_STREAM_API_TOKEN', 'CLOUDFLARE_STREAM_CUSTOMER_CODE'],
    unlocks: 'Transcoded video playback for guest clips',
    without: 'videos play as uploaded, with an ffmpeg poster frame',
    host: 'dash.cloudflare.com', dashboard: 'https://dash.cloudflare.com/?to=/:account/stream',
    ladder: [
      { method: 'mcp', server: 'Cloudflare Developer Platform', how: 'read the account id and mint a Stream token' },
      { method: 'browser', recipe: 'cloudflare-stream' },
      { method: 'manual' },
    ],
    probe: { url: 'https://api.cloudflare.com/client/v4/user/tokens/verify', headers: { authorization: 'Bearer {value}' }, valueVar: 'CLOUDFLARE_STREAM_API_TOKEN' },
  },
  {
    need: 'feature', alternateOf: 'travel', id: 'duffel', title: 'Duffel access token', vars: ['DUFFEL_API_KEY'],
    unlocks: 'Hosted flight and stay checkout links for guests',
    without: 'deep links to Skyscanner and Booking.com, honestly labelled',
    host: 'duffel.com', dashboard: 'https://app.duffel.com/settings/access-tokens',
    ladder: [
      { method: 'authmd', origin: 'https://duffel.com' },
      { method: 'browser', recipe: 'duffel-dashboard' },
      { method: 'manual' },
    ],
    probe: { url: 'https://api.duffel.com/air/airlines?limit=1', headers: { authorization: 'Bearer {value}', 'Duffel-Version': 'v2' } },
  },
  {
    need: 'feature', alternateOf: 'travel', id: 'skyscanner', title: 'Skyscanner partner key', vars: ['SKYSCANNER_API_KEY'],
    unlocks: 'Live flight prices on the Travel page',
    without: 'honest "prices unavailable" copy plus a search link',
    host: 'developers.skyscanner.net', dashboard: 'https://www.partners.skyscanner.net/contact/business-development',
    input: 'apply',
    note: 'Skyscanner reviews partner applications by hand — no endpoint mints this key. Paste it when it arrives.',
    ladder: [{ method: 'manual' }],
  },
  {
    need: 'feature', alternateOf: 'travel', id: 'booking', title: 'Booking.com Demand API', vars: ['BOOKING_DEMAND_API_KEY', 'BOOKING_AFFILIATE_ID'],
    unlocks: 'Live hotel availability near the venue',
    without: 'curated hotel deep links',
    host: 'developers.booking.com', dashboard: 'https://developers.booking.com/',
    input: 'apply',
    note: 'Also a reviewed partner application.',
    ladder: [{ method: 'manual' }],
  },
  {
    need: 'feature', id: 'uber', title: 'Uber for Business', vars: ['UBER_CLIENT_ID', 'UBER_CLIENT_SECRET', 'UBER_ORG_ID', 'UBER_VOUCHER_PROGRAM_ID'],
    unlocks: 'Real ride vouchers for guests who should not drive home',
    without: 'manual codes you hand out, or the mock',
    host: 'developer.uber.com', dashboard: 'https://developer.uber.com/dashboard',
    ladder: [
      { method: 'oauth', origin: 'https://auth.uber.com', authorize: 'https://auth.uber.com/oauth/v2/authorize', token: 'https://auth.uber.com/oauth/v2/token', scope: 'vouchers.read vouchers.write' },
      { method: 'browser', recipe: 'uber-dashboard' },
      { method: 'manual' },
    ],
    note: 'The OAuth step needs an Uber app whose redirect URI is this page; the agent prints the exact URI to register.',
  },
];

/**
 * What the site needs is not a question for Tyler & Sara — the repo already answers it.
 *
 *   `launch`  src/lib/env.ts refuses to boot production without it, or PRODUCT.md lists the
 *             surface it powers as a planned route. Must be real before guests arrive.
 *   `feature`  A shipped surface degrades honestly without it (deep links instead of live
 *             prices, dev inbox instead of e-mail). Worth having, never blocking.
 *   `optional` Tooling for us, invisible to guests.
 *
 * `alternateOf` groups credentials where ONE is enough: any embeddings provider, any travel
 * provider. The queue shows the group once and stops asking after the first one lands.
 */
export const NEED = { launch: 'Needed before guests arrive', feature: 'Makes a shipped page real', optional: 'Tooling for us' };

/** Every variable the registry knows about, mapped to how it is obtained. */
export function varIndex() {
  const index = new Map();
  for (const [name, spec] of Object.entries(AUTOFILL)) {
    index.set(name, { name, method: spec.method, input: 'override', why: spec.why, credential: null });
  }
  for (const cred of CREDENTIALS) {
    for (const name of cred.vars) {
      index.set(name, {
        name,
        method: cred.ladder[0].method,
        input: cred.input || (cred.ladder[0].method === 'manual' ? 'apply' : 'override'),
        why: cred.unlocks,
        credential: cred.id,
      });
    }
  }
  return index;
}

/** Sort method names by how little they ask of a person. */
export function resolveLadderOrder(methods) {
  return [...methods].sort((a, b) => METHOD_RANK[a] - METHOD_RANK[b]);
}

/** The best method on a credential's ladder — the rung the ladder starts on. */
export function bestMethod(cred) {
  return resolveLadderOrder(cred.ladder.map((s) => s.method))[0];
}

/** JSON-safe projection baked into the Secret Drop page by build-page.mjs. */
export function clientRegistry() {
  return {
    generatedAt: new Date().toISOString(),
    methodLabels: METHOD_LABELS,
    autofill: Object.entries(AUTOFILL).map(([name, spec]) => ({ name, method: spec.method, why: spec.why })),
    needs: NEED,
    credentials: CREDENTIALS.map((c) => ({
      id: c.id, title: c.title, vars: c.vars, unlocks: c.unlocks, without: c.without,
      need: c.need || 'optional', alternateOf: c.alternateOf || null,
      dashboard: c.dashboard || null, note: c.note || null, warn: c.warn || null,
      input: c.input || 'override',
      ladder: c.ladder.map((s) => ({ method: s.method, server: s.server || null, how: s.how || null })),
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg === '--json') console.log(JSON.stringify(clientRegistry(), null, 2));
  else {
    console.log('method'.padEnd(10), 'variable'.padEnd(30), 'credential');
    for (const v of varIndex().values()) console.log(v.method.padEnd(10), v.name.padEnd(30), v.credential || '(sandbox)');
  }
}
