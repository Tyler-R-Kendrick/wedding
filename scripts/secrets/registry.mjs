#!/usr/bin/env node
/**
 * What the wedding site needs to connect to, and how each connection gets made.
 *
 * A SLOT is a job to be done ("guest email", "photo storage"). Each slot has several
 * PROVIDER OPTIONS, because there is rarely one right answer — S3 storage alone can be
 * Cloudflare R2, AWS, Backblaze, Supabase or a self-hosted MinIO, and they differ mainly
 * in what the sign-up costs a person. So each option states its own ceremony, and the page
 * lets Tyler & Sara switch between them.
 *
 * Two rules keep the form short:
 *   `fills`   variables the choice itself determines (an R2 endpoint is a function of the
 *             account id) — never asked, always computed.
 *   `secrets` the irreducible material a provider hands out once. Only these can ever
 *             reach a field, and only when every ceremony above them has failed.
 *
 * Consumers: acquire.mjs (runs the ceremony), verify.mjs (probes the result),
 * build-page.mjs (bakes `clientRegistry()` into the page, so the page cannot describe a
 * route the sandbox will not take).
 */

// Recipes carry the page a person can open to make a key themselves; browser-capture loads
// playwright lazily, so importing them here costs nothing.
import { RECIPES } from './browser-capture.mjs';

/** The five things a person can be asked to do, cheapest first. */
export const CEREMONY = {
  // `act` is what you do when the ceremony is already under way; `start` is what the control that
  // BEGINS it says. Both live here so a button can never be labelled something the ceremony does
  // not actually do — "Get the link" was invented in the template, described nothing, and pressed
  // into filing a request that told the reader to open a terminal.
  agent: { rank: 0, label: 'Automatic', asksYou: false, act: null, start: null, detail: 'Claude registers itself' },
  link: { rank: 1, label: 'One link', asksYou: true, act: 'Approve', start: 'Authorize', detail: 'Approve in your browser; the code rides inside the link' },
  signin: { rank: 2, label: 'Sign in once', asksYou: true, act: 'Sign in', start: 'Sign in to', detail: 'Sign in as yourself; Claude reads the key from the dashboard' },
  apply: { rank: 3, label: 'Application', asksYou: true, act: 'Apply', start: 'Apply at', detail: 'A human at the provider reviews it' },
  paste: { rank: 4, label: 'Paste a key', asksYou: true, act: 'Paste', start: null, detail: 'Nothing can obtain this on your behalf' },
};

/** Internal ladder rungs, mapped to the ceremony a person experiences. */
export const METHOD_RANK = { generate: 0, derive: 1, detect: 2, harness: 3, mcp: 4, authmd: 5, register: 6, device: 7, oauth: 8, browser: 9, manual: 10 };
export const METHOD_CEREMONY = {
  generate: 'agent', derive: 'agent', detect: 'agent', harness: 'agent', mcp: 'agent', authmd: 'agent', register: 'agent',
  device: 'link', oauth: 'link', browser: 'signin', manual: 'paste',
};

/** Material the sandbox makes for itself. None of it is ever shown to a person. */
export const AUTOFILL = {
  CONFIRMATION_SECRET: { method: 'generate', bytes: 32, why: 'HMAC for confirmation tokens' },
  CRON_SECRET: { method: 'generate', bytes: 32, why: 'bearer for POST /api/jobs/run' },
  BETTER_AUTH_SECRET: { method: 'generate', bytes: 32, why: 'Better Auth session signing' },
  TEST_AUTH_SECRET: { method: 'generate', bytes: 24, why: 'test-only principal injector' },
  DEV_STORAGE_SECRET: { method: 'generate', bytes: 32, why: 'HMAC for local signed storage URLs' },
  STORAGE_SIGNING_SECRET: { method: 'generate', bytes: 32, why: 'HMAC for local-fs storage URLs' },
  AUDIT_HASH_KEY: { method: 'generate', bytes: 32, why: 'HMAC for audit fingerprints' },
  DEV_INBOX_TOKEN: { method: 'generate', bytes: 24, why: 'bearer for the dev inbox' },
  HEALTH_TOKEN: { method: 'generate', bytes: 24, why: 'bearer for /api/health details' },
  TRANSPORT_SECRETS_KEY: { method: 'generate', bytes: 32, why: 'seals ride codes at rest' },
  DUFFEL_WEBHOOK_SECRET: { method: 'generate', bytes: 32, why: 'signature secret we hand to Duffel' },
  NEXT_PUBLIC_SITE_URL: { method: 'derive', value: 'http://localhost:3000', why: 'local origin' },
  BETTER_AUTH_URL: { method: 'derive', from: 'NEXT_PUBLIC_SITE_URL', why: 'same origin as the site' },
  ADMIN_EMAILS: { method: 'derive', git: 'user.email', why: 'the git identity here is an admin' },
  PW_CHROMIUM_PATH: { method: 'detect', paths: ['/opt/pw-browsers/chromium', '/usr/bin/chromium'], why: 'preinstalled Chromium' },
  FFMPEG_PATH: { method: 'detect', paths: ['/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux', '/usr/bin/ffmpeg'], why: 'ffmpeg for video posters' },
  ASSETS_USER_AGENT: { method: 'derive', value: 'sara-tyler-wedding-site/0.1 (+https://github.com/Tyler-R-Kendrick/wedding)', why: 'Wikimedia/Openverse client UA' },
};

/**
 * `need` comes from the repo, never from a question:
 *   launch   src/lib/env.ts refuses to boot production without it
 *   feature  a shipped page degrades honestly without it
 *   tooling  for us, invisible to guests
 */
export const NEED = { launch: 'Before guests arrive', feature: 'Makes a page real', tooling: 'Needed to build the site' };

const brand = 'sara-tyler-wedding';

const RAW_SLOTS = [
  {
    id: 'email', name: 'Guest email', need: 'launch',
    does: 'Sends one-time sign-in codes and RSVP confirmations',
    without: 'Codes land in a dev inbox nobody reads',
    options: [
      {
        id: 'resend', name: 'Resend', recommended: true, note: 'Registers itself; you approve one link',
        host: 'resend.com', ceremony: 'link',
        // Verified 2026-09-07: POST https://api.resend.com/oauth/register -> 201 with a client_id.
        ladder: [{ method: 'oauth', origin: 'https://api.resend.com', scope: 'emails:send' }, { method: 'browser', recipe: 'resend-dashboard' }, { method: 'manual' }],
        secrets: ['RESEND_API_KEY'],
        fills: { EMAIL_FROM: 'Sara + Tyler <no-reply@{domain}>' },
        probe: { url: 'https://api.resend.com/domains', headers: { authorization: 'Bearer {value}' } },
      },
      {
        id: 'postmark', name: 'Postmark', note: 'Best deliverability for transactional mail',
        host: 'postmarkapp.com', ceremony: 'signin',
        ladder: [{ method: 'browser', recipe: 'postmark-dashboard' }, { method: 'manual' }],
        secrets: ['RESEND_API_KEY'],
        fills: { EMAIL_FROM: 'Sara + Tyler <no-reply@{domain}>' },
      },
    ],
  },
  {
    id: 'storage', name: 'Photo & video storage', need: 'launch',
    does: 'Holds what guests upload, and the galleries',
    without: 'Files sit on the sandbox disk and vanish with it',
    options: [
      {
        id: 'r2', name: 'Cloudflare R2', recommended: true, note: 'No charge for downloads — the one that matters for a gallery',
        host: 'dash.cloudflare.com', ceremony: 'link',
        // Verified 2026-09-07: bindings.mcp.cloudflare.com/register -> 201, PKCE S256 authorize.
        ladder: [
          { method: 'mcp', server: 'Cloudflare Developer Platform', how: 'create an R2 bucket and a scoped token' },
          { method: 'oauth', origin: 'https://bindings.mcp.cloudflare.com' },
          { method: 'browser', recipe: 'cloudflare-r2' }, { method: 'manual' },
        ],
        secrets: ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
        fills: { S3_ENDPOINT: 'https://{account}.r2.cloudflarestorage.com', S3_REGION: 'auto', S3_BUCKET: `${brand}-media`, S3_FORCE_PATH_STYLE: 'true' },
      },
      {
        id: 'aws', name: 'Amazon S3', note: 'The default everywhere; you pay for downloads',
        host: 'console.aws.amazon.com', ceremony: 'signin',
        ladder: [{ method: 'browser', recipe: 'aws-iam-s3' }, { method: 'manual' }],
        secrets: ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
        fills: { S3_ENDPOINT: 'https://s3.{region}.amazonaws.com', S3_REGION: 'us-east-2', S3_BUCKET: `${brand}-media`, S3_FORCE_PATH_STYLE: 'false' },
      },
      {
        id: 'b2', name: 'Backblaze B2', note: 'Cheapest storage; free egress via Cloudflare',
        host: 'secure.backblaze.com', ceremony: 'signin',
        ladder: [{ method: 'browser', recipe: 'backblaze-b2' }, { method: 'manual' }],
        secrets: ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
        fills: { S3_ENDPOINT: 'https://s3.{region}.backblazeb2.com', S3_REGION: 'us-west-004', S3_BUCKET: `${brand}-media`, S3_FORCE_PATH_STYLE: 'true' },
      },
      {
        id: 'supabase-storage', name: 'Supabase Storage', note: 'One account for database and files',
        host: 'supabase.com', ceremony: 'link', pairsWith: 'database:supabase',
        // Verified 2026-09-07: api.supabase.com/platform/oauth/apps/register -> 201.
        ladder: [
          { method: 'mcp', server: 'Supabase', how: 'read the project ref and mint S3 access keys' },
          { method: 'oauth', origin: 'https://api.supabase.com', scope: 'storage:read storage:write projects:read' },
          { method: 'browser', recipe: 'supabase-s3' }, { method: 'manual' },
        ],
        secrets: ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
        fills: { S3_ENDPOINT: 'https://{ref}.supabase.co/storage/v1/s3', S3_REGION: '{region}', S3_BUCKET: 'media', S3_FORCE_PATH_STYLE: 'true' },
      },
      {
        id: 'minio', name: 'Your own MinIO', note: 'Self-hosted; you supply the address',
        host: null, ceremony: 'paste',
        ladder: [{ method: 'manual' }],
        secrets: ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
        fills: { S3_REGION: 'us-east-1', S3_BUCKET: `${brand}-media`, S3_FORCE_PATH_STYLE: 'true' },
      },
    ],
  },
  {
    id: 'database', name: 'Database', need: 'feature',
    does: 'Keeps RSVPs and guest data between sandboxes',
    without: 'Embedded Postgres that resets when the sandbox does',
    options: [
      {
        id: 'supabase', name: 'Supabase', recommended: true, note: 'Registers itself; you approve one link',
        host: 'supabase.com', ceremony: 'link',
        // Verified 2026-09-07: api.supabase.com publishes authorize/token/register; DCR -> 201.
        // (mcp.supabase.com answers 404 on its well-knowns intermittently — use the API origin.)
        ladder: [
          { method: 'mcp', server: 'Supabase', how: 'create_project, then the pooled connection string' },
          { method: 'oauth', origin: 'https://api.supabase.com', scope: 'projects:read projects:write database:read' },
          { method: 'browser', recipe: 'supabase-dashboard' }, { method: 'manual' },
        ],
        secrets: ['DATABASE_URL'], fills: {},
        warn: 'A connection string returned through chat has passed the transcript — rotate the password before real guest data exists.',
      },
      { id: 'neon', name: 'Neon', note: 'Serverless Postgres; scales to zero between visits', host: 'console.neon.tech', ceremony: 'link',
        // Verified 2026-09-07: mcp.neon.tech/api/register -> 200; scopes "read write"; PKCE S256.
        ladder: [{ method: 'oauth', origin: 'https://mcp.neon.tech', scope: 'read write' }, { method: 'browser', recipe: 'neon-console' }, { method: 'manual' }],
        secrets: ['DATABASE_URL'], fills: {} },
      { id: 'vercel-postgres', name: 'Vercel Postgres', note: 'If the site deploys to Vercel anyway', host: 'vercel.com', ceremony: 'link',
        // Verified 2026-09-07: api.vercel.com/login/oauth/register -> 201, but ONLY for a loopback
        // redirect; it refuses the artifact URL ("redirect URIs are not approved"). The sandbox
        // therefore runs this one against 127.0.0.1 and polls, rather than catching a redirect.
        ladder: [
          { method: 'mcp', server: 'Vercel', how: 'create a Postgres store and read its URL' },
          { method: 'oauth', origin: 'https://api.vercel.com', redirect: 'http://127.0.0.1:8976/callback' },
          { method: 'browser', recipe: 'vercel-dashboard' }, { method: 'manual' },
        ],
        secrets: ['DATABASE_URL'], fills: {} },
      { id: 'byo-postgres', name: 'A Postgres you already have', note: 'Any connection string', host: null, ceremony: 'paste',
        ladder: [{ method: 'manual' }], secrets: ['DATABASE_URL'], fills: {} },
    ],
  },
  {
    id: 'concierge', name: 'AI concierge', need: 'launch',
    does: 'Answers guest questions on /ask, captions photos, checks RSVPs',
    without: 'A mock model that only replays fixtures',
    // Anything but Anthropic runs through src/providers/ai-model/openai-compatible.ts, which
    // is the OpenAI chat API pointed at a different base URL — so the choice below is real,
    // and adds no dependency. `fills` carry that base URL and the model ids per vendor.
    options: [
      // The best answer to "which model" is often "none of them". Chrome ships a language model
      // behind the W3C Prompt API; when a guest's browser has it, their question is answered on
      // their own device — no key exists, nothing is billed, nothing leaves the phone. The
      // hosted options below are the fallback for browsers without it, not the other way round.
      { id: 'browser', name: 'The guest\'s own browser', recommended: true, note: 'On-device model, no key, nothing billed, nothing leaves their phone', host: null, ceremony: 'agent',
        ladder: [{ method: 'derive' }],
        secrets: [], fills: { NEXT_PUBLIC_AI_BROWSER_MODEL: 'on' },
        note2: 'Needs a browser with the Prompt API; the site falls back to whichever option is set below.',
        // Not a marketing line: the server hands the browser its evidence and verifies the draft it
        // writes (docs/architecture/ai-grounding.md §8a). Answers stay cited either way.
        evidence: 'src/lib/ai/browser-model.ts + POST /api/ai/chat { mode: "evidence" }' },
      // Ambient auth: a session this machine already holds, borrowed rather than issued.
      { id: 'harness', name: 'A harness you\'re signed in to', note: 'Borrows Claude Code, Codex, Copilot or Ollama — no new key at all', host: null, ceremony: 'agent',
        ladder: [{ method: 'harness' }, { method: 'manual' }],
        secrets: [], fills: {},
        warn: 'A borrowed session is the harness operator\'s identity, for local development. Production still wants its own key.' },
      // Verified 2026-09-07: no RFC 8414/9728 metadata at api.anthropic.com, console.anthropic.com
      // or claude.ai — nothing to register against, so this is an honest sign-in.
      { id: 'anthropic', name: 'Anthropic', note: 'What the site is written against', host: 'console.anthropic.com', ceremony: 'signin',
        ladder: [{ method: 'authmd', origin: 'https://console.anthropic.com' }, { method: 'browser', recipe: 'anthropic-console' }, { method: 'manual' }],
        secrets: ['ANTHROPIC_API_KEY'], fills: {},
        probe: { url: 'https://api.anthropic.com/v1/models?limit=1', headers: { 'x-api-key': '{value}', 'anthropic-version': '2023-06-01' } } },
      // Verified 2026-09-07: mcp.openrouter.ai/oauth/register -> registers; PKCE S256.
      { id: 'openrouter', name: 'OpenRouter', note: 'One key for every model; registers itself, you approve one link', host: 'openrouter.ai', ceremony: 'link',
        ladder: [{ method: 'oauth', origin: 'https://mcp.openrouter.ai' }, { method: 'browser', recipe: 'openrouter-keys' }, { method: 'manual' }],
        secrets: ['OPENAI_API_KEY'],
        fills: { AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_CHAT_MODEL: 'anthropic/claude-sonnet-5', AI_FAST_MODEL: 'anthropic/claude-haiku-4.5' },
        probe: { url: 'https://openrouter.ai/api/v1/models', headers: { authorization: 'Bearer {value}' } } },
      { id: 'openai', name: 'OpenAI', note: 'The reference implementation', host: 'platform.openai.com', ceremony: 'signin',
        ladder: [{ method: 'authmd', origin: 'https://platform.openai.com' }, { method: 'browser', recipe: 'openai-platform' }, { method: 'manual' }],
        secrets: ['OPENAI_API_KEY'], fills: { AI_CHAT_MODEL: 'gpt-5', AI_FAST_MODEL: 'gpt-5-mini' },
        probe: { url: 'https://api.openai.com/v1/models', headers: { authorization: 'Bearer {value}' } } },
      { id: 'groq', name: 'Groq', note: 'Fastest responses; open-weight models', host: 'console.groq.com', ceremony: 'signin',
        ladder: [{ method: 'browser', recipe: 'groq-console' }, { method: 'manual' }],
        secrets: ['OPENAI_API_KEY'],
        fills: { AI_BASE_URL: 'https://api.groq.com/openai/v1', AI_CHAT_MODEL: 'llama-3.3-70b-versatile', AI_FAST_MODEL: 'llama-3.1-8b-instant' } },
      { id: 'together', name: 'Together AI', note: 'Open-weight models at low cost', host: 'api.together.xyz', ceremony: 'signin',
        ladder: [{ method: 'browser', recipe: 'together-console' }, { method: 'manual' }],
        secrets: ['OPENAI_API_KEY'],
        fills: { AI_BASE_URL: 'https://api.together.xyz/v1', AI_CHAT_MODEL: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', AI_FAST_MODEL: 'meta-llama/Llama-3.1-8B-Instruct-Turbo' } },
      { id: 'mistral', name: 'Mistral', note: 'European hosting', host: 'console.mistral.ai', ceremony: 'signin',
        ladder: [{ method: 'browser', recipe: 'mistral-console' }, { method: 'manual' }],
        secrets: ['OPENAI_API_KEY'],
        fills: { AI_BASE_URL: 'https://api.mistral.ai/v1', AI_CHAT_MODEL: 'mistral-large-latest', AI_FAST_MODEL: 'mistral-small-latest' } },
      { id: 'deepseek', name: 'DeepSeek', note: 'Cheapest per token', host: 'platform.deepseek.com', ceremony: 'signin',
        ladder: [{ method: 'browser', recipe: 'deepseek-platform' }, { method: 'manual' }],
        secrets: ['OPENAI_API_KEY'],
        fills: { AI_BASE_URL: 'https://api.deepseek.com/v1', AI_CHAT_MODEL: 'deepseek-chat', AI_FAST_MODEL: 'deepseek-chat' } },
      { id: 'ollama', name: 'Your own Ollama', note: 'Runs on your machine; nothing leaves it', host: null, ceremony: 'paste',
        ladder: [{ method: 'manual' }],
        secrets: ['AI_BASE_URL'],
        fills: { OPENAI_API_KEY: 'ollama', AI_CHAT_MODEL: 'llama3.3', AI_FAST_MODEL: 'llama3.2' } },
    ],
  },
  {
    id: 'video', name: 'Video playback', need: 'feature',
    does: 'Transcodes guest clips so they play on any phone',
    without: 'Clips play as uploaded, with an ffmpeg poster frame',
    options: [
      { id: 'cloudflare-stream', name: 'Cloudflare Stream', recommended: true, note: 'Pairs with R2', host: 'dash.cloudflare.com', ceremony: 'link',
        ladder: [
          { method: 'mcp', server: 'Cloudflare Developer Platform', how: 'read the account id and mint a Stream token' },
          { method: 'oauth', origin: 'https://bindings.mcp.cloudflare.com' },
          { method: 'browser', recipe: 'cloudflare-stream' }, { method: 'manual' },
        ],
        secrets: ['CLOUDFLARE_STREAM_API_TOKEN'], fills: { CLOUDFLARE_ACCOUNT_ID: '{account}', CLOUDFLARE_STREAM_CUSTOMER_CODE: '{customer}' },
        probe: { url: 'https://api.cloudflare.com/client/v4/user/tokens/verify', headers: { authorization: 'Bearer {value}' }, valueVar: 'CLOUDFLARE_STREAM_API_TOKEN' } },
      { id: 'none-video', name: 'Skip it', note: 'ffmpeg posters only — perfectly fine for a wedding', host: null, ceremony: 'agent',
        ladder: [{ method: 'derive' }], secrets: [], fills: {}, isOptOut: true },
    ],
  },
  {
    id: 'travel', name: 'Flights & hotels', need: 'feature',
    does: 'Live prices on the Travel page instead of a link',
    without: 'Honest "check current prices" deep links',
    options: [
      // Verified 2026-09-07: nothing published at api.duffel.com, app.duffel.com or mcp.duffel.com.
      { id: 'duffel', name: 'Duffel', recommended: true, note: 'Self-serve token; flights and stays in one', host: 'app.duffel.com', ceremony: 'signin',
        ladder: [{ method: 'authmd', origin: 'https://duffel.com' }, { method: 'browser', recipe: 'duffel-dashboard' }, { method: 'manual' }],
        secrets: ['DUFFEL_API_KEY'], fills: { FLIGHTS_PROVIDER: 'duffel-links', HOTELS_PROVIDER: 'duffel-stays' },
        probe: { url: 'https://api.duffel.com/air/airlines?limit=1', headers: { authorization: 'Bearer {value}', 'Duffel-Version': 'v2' } } },
      { id: 'skyscanner', name: 'Skyscanner', note: 'Reviewed partner application — weeks, not minutes', host: 'www.partners.skyscanner.net', ceremony: 'apply',
        ladder: [{ method: 'manual' }], secrets: ['SKYSCANNER_API_KEY'], fills: { FLIGHTS_PROVIDER: 'skyscanner' } },
      { id: 'booking', name: 'Booking.com', note: 'Also a reviewed application; hotels only', host: 'developers.booking.com', ceremony: 'apply',
        ladder: [{ method: 'manual' }], secrets: ['BOOKING_DEMAND_API_KEY', 'BOOKING_AFFILIATE_ID'], fills: { HOTELS_PROVIDER: 'booking' } },
      { id: 'deep-link', name: 'Just link out', note: 'No account, no key, no prices', host: null, ceremony: 'agent',
        ladder: [{ method: 'derive' }], secrets: [], fills: { FLIGHTS_PROVIDER: 'deep-link', HOTELS_PROVIDER: 'deep-link' }, isOptOut: true },
    ],
  },
  {
    id: 'rides', name: 'Ride vouchers', need: 'feature',
    does: 'Gets guests home safely on the night',
    without: 'Codes you hand out yourself',
    options: [
      { id: 'uber', name: 'Uber for Business', recommended: true, note: 'Vouchers charged to one account', host: 'developer.uber.com', ceremony: 'signin',
        ladder: [{ method: 'oauth', origin: 'https://auth.uber.com', authorize: 'https://auth.uber.com/oauth/v2/authorize', token: 'https://auth.uber.com/oauth/v2/token', scope: 'vouchers.read vouchers.write' }, { method: 'browser', recipe: 'uber-dashboard' }, { method: 'manual' }],
        secrets: ['UBER_CLIENT_ID', 'UBER_CLIENT_SECRET'], fills: { TRANSPORT_BENEFIT_MODE: 'uber', UBER_ORG_ID: '{org}', UBER_VOUCHER_PROGRAM_ID: '{program}' },
        // Verified 2026-09-07: auth.uber.com advertises an oauth.dcr scope and a registration
        // endpoint, but POSTing to it answers 403 "Missing csrf token" — it is browser-gated,
        // so the agent cannot register itself here and this falls through to a sign-in.
        note2: 'Uber gates client registration behind a browser CSRF token, so this needs one sign-in.' },
      { id: 'manual-codes', name: 'Codes you print', note: 'No account; you distribute them', host: null, ceremony: 'agent',
        ladder: [{ method: 'generate' }], secrets: [], fills: { TRANSPORT_BENEFIT_MODE: 'manual-code' }, isOptOut: true },
    ],
  },
  {
    id: 'media', name: 'Generated media', need: 'tooling',
    // Required, and BOTH of them: fal.ai and Higgsfield are not alternatives to choose
    // between, so this slot acquires every option rather than a chosen one. `stock` and
    // `comps` are the optional tooling.
    required: true, acquireAll: true,
    does: 'Images, video and audio: mood boards, textures, grounds, motion tests and sound',
    without: 'Only the licensed placeholder set already committed',
    options: [
      { id: 'fal', name: 'fal.ai', recommended: true, note: 'One key for image, video and audio models; what scripts/fal-generate.mjs calls', host: 'fal.ai', ceremony: 'signin',
        // Verified 2026-09-07: auth.fal.ai (Auth0) advertises a registration_endpoint and a device
        // grant, but POSTing answers "dynamic client registration is disabled". Sign-in it is.
        ladder: [{ method: 'authmd', origin: 'https://fal.ai' }, { method: 'browser', recipe: 'fal-dashboard' }, { method: 'manual' }],
        secrets: ['FAL_KEY'], fills: {},
        probe: { url: 'https://rest.alpha.fal.ai/tokens/', headers: { authorization: 'Key {value}' } } },
      {
        id: 'higgsfield', name: 'Higgsfield',
        note: 'Soul holds an identity across image, video and audio; sign in once, no key to paste',
        host: 'higgsfield.ai', ceremony: 'signin',
        /*
         * Verified 2026-09-08. `mcp.higgsfield.ai/mcp` answers the MCP auth challenge, publishes
         * RFC 9728/8414 metadata and mints a client under RFC 7591 — so this could be an
         * "Authorize" link like Resend's. It deliberately is not, because there would be nowhere
         * to put what comes back: the vendored CLI (`@higgsfield/cli`) runs its own OAuth
         * (HIGGSFIELD_OAUTH_*) and writes a credentials file (HIGGSFIELD_CREDENTIALS_PATH), and
         * `.claude/skills/higgsfield-*` call `higgsfield account status`, not an API key. There is
         * no HIGGSFIELD_API_KEY in `src/` or `.mcp.json`, and inventing one so the page had a
         * field to show would be exactly the plausible fiction this repo bans.
         *
         * So: no secret, and the rung is `mcp` — Claude authorizes the server it is already
         * configured for in `.mcp.json`. It is listed because it is required, not because
         * anything here needs typing.
         */
        /*
         * The credential is a CLI session on the machine, not a value to seal — the vendored
         * `@higgsfield/cli` runs its own OAuth and writes a credentials file, and the skills call
         * `higgsfield account status`. For a while I read "no environment variable" as "the page
         * cannot offer this", which was the same mistake as reading "no CORS" as "the ceremony
         * cannot start". The machine has a shell: `cli-login.mjs` runs the login, the CLI prints
         * a link, and `runJob` streams it back to the strip. The person approves in their own
         * browser and nothing secret goes through the page.
         */
        handoffKind: 'cli', cli: 'higgsfield',
        ladder: [
          { method: 'mcp', server: 'higgsfield', how: 'the MCP server is already configured in .mcp.json' },
          { method: 'browser', cli: 'higgsfield', how: '`higgsfield auth login`, streamed to the page' },
          { method: 'manual' },
        ],
        secrets: [], fills: {},
      },
    ],
  },
  {
    /*
     * Identity, as a first-class connection with real alternatives.
     *
     * Ceremonies here were probed on 2026-09-08, not assumed, and the apex domains are the wrong
     * place to look — auth0.com, clerk.com and workos.com all publish nothing. What they actually
     * run:
     *   mcp.workos.com    RFC 7591 registration AND a device flow; workos.com/auth.md documents
     *                     provisioning a ONE-SHOT environment with no account at all, claimed by
     *                     a person later. That is a real agent ceremony, so WorkOS asks nobody.
     *   api.supabase.com  registration works (auth:read auth:write among its scopes), but it
     *                     issues confidential clients only, so the artifact asks Claude.
     *   mcp.clerk.com     OAuth, no registration — a client must exist first, so: sign in.
     *   auth0.com         nothing published at the apex or at mcp.auth0.com. Auth0 does per-tenant
     *                     registration at <tenant>.auth0.com/oidc/register, which needs a tenant
     *                     to exist first, so the first step is still a person. Sign in.
     */
    id: 'identity', name: 'Sign-in & sessions', need: 'launch',
    does: 'Proves a guest is who they say, and keeps them signed in',
    without: 'Nobody can open their own RSVP',
    options: [
      { id: 'better-auth', name: 'Better Auth', recommended: true,
        note: 'What the site is built on — self-hosted, no account, keys generated here',
        host: null, ceremony: 'agent',
        ladder: [{ method: 'generate', bytes: 32 }, { method: 'derive' }],
        secrets: [], fills: {} },
      { id: 'workos', name: 'WorkOS', note: 'Provisions itself with no account; you claim it later',
        host: 'workos.com', ceremony: 'agent',
        ladder: [
          { method: 'authmd', origin: 'https://workos.com' },
          { method: 'device', origin: 'https://mcp.workos.com' },
          { method: 'manual' },
        ],
        secrets: ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID'], fills: {},
        warn: 'A one-shot environment is anonymous until someone claims it at dashboard.workos.com.' },
      { id: 'supabase-auth', name: 'Supabase Auth', note: 'One account for the database and sign-in',
        host: 'supabase.com', ceremony: 'link', pairsWith: 'database:supabase',
        ladder: [
          { method: 'oauth', origin: 'https://api.supabase.com', scope: 'auth:read auth:write projects:read' },
          { method: 'browser', recipe: 'supabase-auth-keys' },
          { method: 'manual' },
        ],
        secrets: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'], fills: {} },
      { id: 'clerk', name: 'Clerk', note: 'Drop-in UI; its MCP server has OAuth but no self-registration',
        host: 'clerk.com', ceremony: 'signin',
        ladder: [{ method: 'browser', recipe: 'clerk-dashboard' }, { method: 'manual' }],
        secrets: ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'], fills: {} },
      { id: 'auth0', name: 'Auth0', note: 'Registration is per-tenant, so a tenant has to exist first',
        host: 'auth0.com', ceremony: 'signin',
        ladder: [{ method: 'browser', recipe: 'auth0-dashboard' }, { method: 'manual' }],
        secrets: ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET'], fills: {} },
    ],
  },
  {
    /*
     * Counters and rate limits, which are NOT the database even though they can live in it. In
     * production the memory backend is a configuration error (`rate-limit/index.ts` throws), so
     * this is a real decision with a real consequence rather than a preference.
     */
    id: 'cache', name: 'Rate limiting & counters', need: 'feature',
    does: 'Holds the per-guest counters that stop the concierge and RSVP being hammered',
    without: 'Counters live in one process and reset whenever it does',
    options: [
      { id: 'db-backed', name: 'In the database', recommended: true,
        note: 'Survives a restart and is correct across instances',
        host: null, ceremony: 'agent',
        ladder: [{ method: 'derive' }],
        secrets: [], fills: { RATE_LIMIT_BACKEND: 'db' } },
      { id: 'memory', name: 'In memory', note: 'Development only — production refuses this',
        host: null, ceremony: 'agent',
        ladder: [{ method: 'derive' }],
        secrets: [], fills: { RATE_LIMIT_BACKEND: 'memory' }, isOptOut: true,
        warn: 'Production refuses to start with the memory backend, by design.' },
    ],
  },
  {
    id: 'gifts', name: 'Registry & cash fund', need: 'feature',
    does: 'Points guests at where you are registered and how to contribute',
    without: 'The gifts page says there is nothing to link to yet',
    options: [
      { id: 'links', name: 'Your own links', recommended: true,
        note: 'Whatever you are registered with — no account here',
        host: null, ceremony: 'paste',
        ladder: [{ method: 'manual' }],
        secrets: ['REGISTRY_LINKS_JSON', 'CASH_FUND_LINKS_JSON'], fills: {} },
      { id: 'none-gifts', name: 'Skip it', note: 'No gifts page', host: null, ceremony: 'agent',
        ladder: [{ method: 'derive' }], secrets: [], fills: {}, isOptOut: true },
    ],
  },
  {
    id: 'maps', name: 'Directions', need: 'feature',
    does: 'Gets guests from where they are to the ceremony, the hotels and the parking',
    without: 'Nothing — this needs no account',
    options: [
      { id: 'deep-link-maps', name: 'Deep links', recommended: true,
        note: 'Opens whichever map app the guest already uses — no key, no billing, no tracking',
        host: null, ceremony: 'agent',
        ladder: [{ method: 'derive' }], secrets: [], fills: {} },
    ],
  },
  {
    id: 'reservations', name: 'Restaurant links', need: 'feature',
    does: 'Points at the places you recommend for the nights around the wedding',
    without: 'Nothing — this needs no account',
    options: [
      { id: 'deep-link-tables', name: 'Deep links', recommended: true,
        note: 'Links straight to each restaurant — no key, no billing',
        host: null, ceremony: 'agent',
        ladder: [{ method: 'derive' }], secrets: [], fills: {} },
    ],
  },
  {
    /*
     * Face grouping is off, and off is a finished state rather than a missing one. The provider
     * is a mock that detects nothing, and the activation matrix says it must not be enabled in
     * production without counsel review — biometric data carries duties (BIPA and friends) that a
     * wedding website has no business taking on by accident. Listing it says so out loud instead
     * of leaving a capability nobody decided about.
     */
    id: 'faces', name: 'Grouping photos by face', need: 'feature',
    does: 'Would let a guest find every photo they are in',
    without: 'Guests browse and search by words, which is what the site does today',
    options: [
      { id: 'faces-off', name: 'Off', recommended: true,
        note: 'No biometric data is collected or stored',
        host: null, ceremony: 'agent',
        ladder: [{ method: 'derive' }], secrets: [], fills: {}, isOptOut: true,
        warn: 'Turning this on means processing biometric data, which needs legal review first.' },
    ],
  },
  {
    id: 'stock', name: 'Licensed photography', need: 'tooling',
    does: 'Real, openly licensed photographs — not generated, and not of anyone you know',
    without: 'The licensed placeholder set already committed',
    options: [
      { id: 'openverse', name: 'Openverse', recommended: true,
        note: 'Openly licensed work from Flickr, Wikimedia and others; Claude registers itself',
        host: 'api.openverse.org', ceremony: 'agent',
        ladder: [
          { method: 'register', url: 'https://api.openverse.org/v1/auth_tokens/register/', body: { name: brand, description: 'Placeholder imagery for a private wedding website', email: '{admin_email}' }, map: { OPENVERSE_CLIENT_ID: 'client_id', OPENVERSE_CLIENT_SECRET: 'client_secret' }, confirm: 'Openverse emails a verification link; it works at the anonymous rate until clicked.' },
          { method: 'manual' },
        ],
        secrets: ['OPENVERSE_CLIENT_ID', 'OPENVERSE_CLIENT_SECRET'], fills: {} },
      { id: 'none-stock', name: 'Skip it', note: 'Use what is committed', host: null, ceremony: 'agent',
        ladder: [{ method: 'derive' }], secrets: [], fills: {}, isOptOut: true },
    ],
  },
  {
    id: 'comps', name: 'Design comps', need: 'tooling',
    does: 'Generates screen mock-ups to compare directions against',
    without: 'Comps are built by hand in the browser, which is slower but works',
    options: [
      { id: 'stitch', name: 'Google Stitch', recommended: true,
        note: 'Screen mock-ups and an alternative DESIGN.md to compare with ours',
        host: 'stitch.withgoogle.com', ceremony: 'paste',
        ladder: [{ method: 'authmd', origin: 'https://stitch.withgoogle.com' }, { method: 'manual' }],
        secrets: ['STITCH_API_KEY'], fills: {} },
      { id: 'none-comps', name: 'Skip it', note: 'Build comps by hand', host: null, ceremony: 'agent',
        ladder: [{ method: 'derive' }], secrets: [], fills: {}, isOptOut: true },
    ],
  },
];

/**
 * Every option carries the same fields, whether or not it declares them. Uniform shape keeps
 * the data honest (no "does this one have a note?" at every call site) and lets TypeScript
 * infer one type for the whole table instead of a 28-member union.
 */
function normalizeOption(raw) {
  return {
    id: raw.id,
    name: raw.name,
    note: raw.note ?? null,
    recommended: raw.recommended === true,
    isOptOut: raw.isOptOut === true,
    ceremony: raw.ceremony ?? null,
    host: raw.host ?? null,
    ladder: raw.ladder ?? [],
    secrets: raw.secrets ?? [],
    fills: raw.fills ?? {},
    probe: raw.probe ?? null,
    warn: raw.warn ?? null,
    pairsWith: raw.pairsWith ?? null,
    // What performs a press, when it is not the kind the ceremony implies. Higgsfield's ceremony
    // is a sign-in, but the thing that performs it is that provider's own CLI login rather than a
    // browser relay. Left out of here, the field existed in the source and was silently dropped
    // on the way to the page — which is a worse failure than not having written it, because the
    // registry read as if it were configured.
    handoffKind: raw.handoffKind ?? null,
    cli: raw.cli ?? null,
  };
}

export const SLOTS = RAW_SLOTS.map((slot) => ({
  required: slot.required === true,
  // Whether the slot's options are alternatives at all. `media` needs fal.ai AND Higgsfield, so
  // the ladder takes every option instead of a chosen one.
  acquireAll: slot.acquireAll === true,
  id: slot.id, name: slot.name, need: slot.need, does: slot.does, without: slot.without,
  options: slot.options.map(normalizeOption),
}));

/* ------------------------------------------------------------------ helpers */

export const slotById = new Map(SLOTS.map((s) => [s.id, s]));
export const optionOf = (slotId, optionId) => slotById.get(slotId)?.options.find((o) => o.id === optionId) || null;
export const recommendedOf = (slot) => slot.options.find((o) => o.recommended) || slot.options[0];

/** The option in force for a slot: an explicit choice, else the recommendation. */
export function chosenOption(slot, choices = {}) {
  return optionOf(slot.id, choices[slot.id]) || recommendedOf(slot);
}

/**
 * What a person should expect this option to cost them. The declared `ceremony` wins,
 * because it reflects what the provider actually does today: a ladder that *starts* at
 * auth.md still ends in a sign-in when the provider publishes no agent metadata, and
 * promising "automatic" there would be a lie the page then has to take back. A live
 * `nextAction` from the sandbox refines this per run.
 */
export function ceremonyOf(option) {
  if (option.ceremony) return option.ceremony;
  const best = [...option.ladder].sort((a, b) => METHOD_RANK[a.method] - METHOD_RANK[b.method])[0];
  return METHOD_CEREMONY[best?.method] || 'paste';
}

/**
 * The browser recipe an option would fall back to, by id.
 *
 * The page needs this, not the host: `browser-capture.mjs relay` resolves a recipe id or a recipe's
 * *exact* host, and an option's `host` is the brand domain a person would type (postmarkapp.com)
 * while the recipe's is the dashboard it actually drives (account.postmarkapp.com). Sending the
 * host meant "unknown provider postmarkapp.com" — a button that dispatched work that could not run.
 */
export function browserRecipeOf(option) {
  return option.ladder?.find((step) => step.method === 'browser')?.recipe || null;
}

/**
 * Which OAuth origins a BROWSER may talk to, probed rather than assumed.
 *
 * This decides whether the published artifact can run a one-link ceremony by itself or must hand
 * the person a route that does not depend on anything else being awake. The artifact is a page
 * with its own origin and no server behind it: if the provider sends no `Access-Control-Allow-
 * Origin`, the page cannot register a client or exchange a code, full stop — and offering the
 * ceremony anyway is how "Asked just now" came to mean "nothing will ever happen".
 *
 * Verified 2026-09-08 by sending `Origin:` from three different origins (claude.ai, an
 * artifact-shaped subdomain, and example.invalid) at each `registration_endpoint` and
 * `token_endpoint` named in the provider's own RFC 8414 metadata. `reflects` records what came
 * back, because "*" and "echoes whatever you sent" are both usable from an artifact while an
 * allowlist of one origin would not be.
 *
 * Checked on the REAL POST, not the preflight, and that distinction changed an answer. Neon's
 * `OPTIONS` preflight returns `Access-Control-Allow-Origin: *` for both endpoints — but its
 * actual `POST` responses carry no such header, so a browser completes the preflight, sends the
 * request, and is then refused the reply. Trusting the preflight would have shipped a button that
 * registers a client nobody can read back. A ceremony counts as browser-runnable only when every
 * response the flow must READ says so.
 */
export const BROWSER_AUTH = {
  // register -> 201 ACAO echoes the caller; token -> 401 ACAO echoes the caller.
  'https://bindings.mcp.cloudflare.com': { ok: true, reflects: 'origin', checkedAt: '2026-09-08' },
  // register -> 201 ACAO *; token -> 400 ACAO *.
  'https://mcp.openrouter.ai': { ok: true, reflects: '*', checkedAt: '2026-09-08' },
  // Preflight says `*`; the POST responses say nothing. A browser cannot read either reply.
  'https://mcp.neon.tech': { ok: false, reflects: 'preflight only', checkedAt: '2026-09-08' },
  'https://api.resend.com': { ok: false, reflects: null, checkedAt: '2026-09-08' },
  'https://api.supabase.com': { ok: false, reflects: null, checkedAt: '2026-09-08' },
  // No RFC 8414 metadata at all, so there is nothing for a browser to discover either.
  'https://api.vercel.com': { ok: false, reflects: null, checkedAt: '2026-09-08' },
  'https://auth.uber.com': { ok: false, reflects: null, checkedAt: '2026-09-08' },
};

/** The oauth rung an option would take, if it has one. */
export function oauthRungOf(option) {
  return option.ladder?.find((step) => step.method === 'oauth') || null;
}

/**
 * Whether a page — with no server behind it — could run this option's one-link ceremony itself.
 * Unprobed origins are `false`: an unproven route is not a route.
 */
export function browserAuthOf(option) {
  const rung = oauthRungOf(option);
  return Boolean(rung?.origin && BROWSER_AUTH[rung.origin]?.ok);
}

/** Every variable any option could fill — used to keep autofill and the slots disjoint. */
export function allVars() {
  const vars = new Set();
  for (const slot of SLOTS) for (const o of slot.options) {
    for (const v of o.secrets) vars.add(v);
    for (const v of Object.keys(o.fills)) vars.add(v);
  }
  return vars;
}

/**
 * The page a person can open to make this key themselves.
 *
 * Every sign-in option has one (asserted in the tests), which is what makes the published artifact
 * able to finish a sign-in with no agent and no server: the human is already at a browser, so the
 * honest route is the provider's own key page plus a field, not a headless relay nothing will run.
 */
export function keysUrlOf(option) {
  const recipe = browserRecipeOf(option);
  return (recipe && RECIPES[recipe]?.keysUrl) || (option.host ? `https://${option.host}` : null);
}

/** JSON-safe projection baked into the page. */
export function clientRegistry() {
  return {
    generatedAt: new Date().toISOString(),
    ceremony: CEREMONY,
    methodCeremony: METHOD_CEREMONY,
    need: NEED,
    autofillCount: Object.keys(AUTOFILL).length,
    autofillNames: Object.keys(AUTOFILL),
    slots: SLOTS.map((slot) => ({
      id: slot.id, name: slot.name, need: slot.need, required: slot.required === true,
      acquireAll: slot.acquireAll === true, does: slot.does, without: slot.without,
      options: slot.options.map((o) => ({
        id: o.id, name: o.name, note: o.note || null, recommended: !!o.recommended, isOptOut: !!o.isOptOut,
        ceremony: ceremonyOf(o), host: o.host || null, recipe: browserRecipeOf(o),
        // Where a person can do it themselves, and whether a page with no server behind it could
        // do it for them. Together these are what let the published artifact finish a ceremony
        // instead of queueing one: an artifact only ever offers a route that ends somewhere.
        keysUrl: keysUrlOf(o),
        browserAuth: browserAuthOf(o),
        oauth: oauthRungOf(o) ? { origin: oauthRungOf(o).origin ?? null, scope: oauthRungOf(o).scope ?? null } : null,
        // What kind of work a press should ask for, and which login it names. Most options want
        // the kind their ceremony implies; one whose credential is a CLI session on the machine
        // says so here, because "sign in" through a browser relay is not the same job as running
        // that provider's own CLI login.
        handoffKind: o.handoffKind || null, cli: o.cli || null,
        secrets: o.secrets, inferred: Object.keys(o.fills),
        warn: o.warn || null,
      })),
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === '--json') console.log(JSON.stringify(clientRegistry(), null, 2));
  else {
    console.log('slot'.padEnd(12), 'option'.padEnd(22), 'ceremony'.padEnd(10), 'asks for'.padEnd(34), 'inferred');
    for (const slot of SLOTS) for (const o of slot.options) {
      console.log(
        (o === slot.options[0] ? slot.id : '').padEnd(12),
        (o.name + (o.recommended ? ' *' : '')).padEnd(22),
        ceremonyOf(o).padEnd(10),
        (o.secrets.join(', ') || '—').padEnd(34),
        Object.keys(o.fills).length || '—',
      );
    }
  }
}
