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

/** The five things a person can be asked to do, cheapest first. */
export const CEREMONY = {
  agent: { rank: 0, label: 'Automatic', asksYou: false, act: null, detail: 'Claude registers itself' },
  link: { rank: 1, label: 'One link', asksYou: true, act: 'Approve', detail: 'Approve in your browser; the code rides inside the link' },
  signin: { rank: 2, label: 'Sign in once', asksYou: true, act: 'Sign in', detail: 'Sign in as yourself; Claude reads the key from the dashboard' },
  apply: { rank: 3, label: 'Application', asksYou: true, act: 'Apply', detail: 'A human at the provider reviews it' },
  paste: { rank: 4, label: 'Paste a key', asksYou: true, act: 'Paste', detail: 'Nothing can obtain this on your behalf' },
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
export const NEED = { launch: 'Before guests arrive', feature: 'Makes a page real', tooling: 'For us' };

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
      {
        id: 'ses', name: 'Amazon SES', note: 'Cheapest at volume; needs an AWS account out of sandbox',
        host: 'console.aws.amazon.com', ceremony: 'signin',
        ladder: [{ method: 'browser', recipe: 'aws-ses' }, { method: 'manual' }],
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
        note2: 'Needs a browser with the Prompt API; the site falls back to whichever option is set below.' },
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
    id: 'search', name: 'Photo & story search', need: 'feature',
    does: 'Finds "the one on the beach" without tags',
    without: 'A hashed stand-in — search works, but worse',
    options: [
      { id: 'voyage', name: 'Voyage AI', recommended: true, note: 'Best recall per dollar for this size', host: 'dashboard.voyageai.com', ceremony: 'signin',
        ladder: [{ method: 'authmd', origin: 'https://www.voyageai.com' }, { method: 'browser', recipe: 'voyage-dashboard' }, { method: 'manual' }],
        secrets: ['VOYAGE_API_KEY'], fills: { EMBEDDINGS_PROVIDER: 'voyage' },
        probe: { url: 'https://api.voyageai.com/v1/embeddings', method: 'POST', headers: { authorization: 'Bearer {value}', 'content-type': 'application/json' }, body: '{"input":["ping"],"model":"voyage-3-lite"}' } },
      { id: 'openai-embed', name: 'OpenAI', note: 'One key for chat and search if you use it for both', host: 'platform.openai.com', ceremony: 'signin',
        ladder: [{ method: 'authmd', origin: 'https://platform.openai.com' }, { method: 'browser', recipe: 'openai-platform' }, { method: 'manual' }],
        secrets: ['OPENAI_API_KEY'], fills: { EMBEDDINGS_PROVIDER: 'openai' } },
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
    id: 'imagery', name: 'Design imagery', need: 'tooling',
    does: 'Mood boards and textures for the design work',
    without: 'The licensed placeholder set already in the repo',
    options: [
      { id: 'fal', name: 'fal.ai', recommended: true, note: 'What scripts/fal-generate.mjs calls', host: 'fal.ai', ceremony: 'signin',
        // Verified 2026-09-07: auth.fal.ai (Auth0) advertises a registration_endpoint and a device
        // grant, but POSTing answers "dynamic client registration is disabled". Sign-in it is.
        ladder: [{ method: 'authmd', origin: 'https://fal.ai' }, { method: 'browser', recipe: 'fal-dashboard' }, { method: 'manual' }],
        secrets: ['FAL_KEY'], fills: {},
        probe: { url: 'https://rest.alpha.fal.ai/tokens/', headers: { authorization: 'Key {value}' } } },
      { id: 'stitch', name: 'Google Stitch', note: 'Comp generator; optional alternative', host: 'stitch.withgoogle.com', ceremony: 'paste',
        ladder: [{ method: 'authmd', origin: 'https://stitch.withgoogle.com' }, { method: 'manual' }], secrets: ['STITCH_API_KEY'], fills: {} },
      { id: 'openverse', name: 'Openverse', note: 'Free licensed photography; Claude signs itself up', host: 'api.openverse.org', ceremony: 'agent',
        ladder: [{ method: 'register', url: 'https://api.openverse.org/v1/auth_tokens/register/', body: { name: brand, description: 'Placeholder imagery for a private wedding website', email: '{admin_email}' }, map: { OPENVERSE_CLIENT_ID: 'client_id', OPENVERSE_CLIENT_SECRET: 'client_secret' }, confirm: 'Openverse emails a verification link; it works at the anonymous rate until clicked.' }, { method: 'manual' }],
        secrets: ['OPENVERSE_CLIENT_ID', 'OPENVERSE_CLIENT_SECRET'], fills: {} },
      { id: 'none-imagery', name: 'Skip it', note: 'Use what is committed', host: null, ceremony: 'agent',
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
  };
}

export const SLOTS = RAW_SLOTS.map((slot) => ({
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

/** Every variable any option could fill — used to keep autofill and the slots disjoint. */
export function allVars() {
  const vars = new Set();
  for (const slot of SLOTS) for (const o of slot.options) {
    for (const v of o.secrets) vars.add(v);
    for (const v of Object.keys(o.fills)) vars.add(v);
  }
  return vars;
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
      id: slot.id, name: slot.name, need: slot.need, does: slot.does, without: slot.without,
      options: slot.options.map((o) => ({
        id: o.id, name: o.name, note: o.note || null, recommended: !!o.recommended, isOptOut: !!o.isOptOut,
        ceremony: ceremonyOf(o), host: o.host || null,
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
