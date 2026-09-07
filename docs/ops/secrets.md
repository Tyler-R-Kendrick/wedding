# Credentials without the model in the loop ("Secret Drop")

Claude Code on the web cannot change a running container's environment, and pasting keys
into chat sends them through the model. This repo answers that twice over:

1. **Don't ask.** Most variables never need a human. The sandbox mints them, derives them,
   finds them on disk, provisions them through a connected MCP server, or registers itself
   with the provider. A field on a form is the *last* resort, not the first.
   That includes not asking *which features the site has*: `src/lib/env.ts` already declares
   what production refuses to start without, and `PRODUCT.md` already lists the planned
   surfaces. The plan is derived from the repo — `npm run secrets:acquire` takes no
   arguments and goes after everything the site needs.
2. **When you must ask, ask for a click, not a key.** A delegated authorization — an
   auth.md claim, an RFC 8628 device link, an OAuth redirect this page catches — leaves the
   secret between you and the provider. When a value really does have to be typed, it is
   sealed in your browser tab and only ciphertext is ever stored.

Secret Drop page: <https://claude.ai/code/artifact/1f7c6ffb-f3f3-456e-8ebb-623f5124782c>
(private artifact; rebuild and republish it with `npm run secrets:page`).

## Slots and provider options

Every connection is a **slot** — a job to be done — and each slot has several **provider
options**, because there is rarely one right answer. S3-compatible storage alone can be
Cloudflare R2, AWS, Backblaze, Supabase or a MinIO you host; they differ mainly in what
signing up costs a person. `scripts/secrets/registry.mjs` declares them, and the Secret Drop
page lets Tyler & Sara switch between them with one press.

| Slot | Options (recommended first) |
|---|---|
| Guest email | Resend · Postmark · Amazon SES |
| Photo & video storage | Cloudflare R2 · Amazon S3 · Backblaze B2 · Supabase Storage · your own MinIO |
| Database | Supabase · Neon · Vercel Postgres · a Postgres you already have |
| AI concierge | Anthropic · OpenRouter · OpenAI · Groq · Together · Mistral · DeepSeek · your own Ollama |
| Photo & story search | Voyage AI · OpenAI |
| Video playback | Cloudflare Stream · skip it |
| Flights & hotels | Duffel · Skyscanner · Booking.com · just link out |
| Ride vouchers | Uber for Business · codes you print |
| Design imagery | fal.ai · Google Stitch · Openverse · skip it |

Two rules keep the form short:

- **`fills`** — settings the choice itself determines. Picking R2 fixes the endpoint, region,
  bucket and path style; picking Backblaze fixes different ones. Four settings that used to be
  four fields are now a consequence of one press.
- **`secrets`** — the irreducible material a provider hands out once. Only these can ever reach
  a field, and only after every ceremony above them has failed.

## What a person is ever asked to do

| Ceremony | What happens | Presses |
|---|---|---|
| **Automatic** | Claude registers itself (auth.md), provisions through an MCP server, or signs itself up | 0 |
| **One link** | Approve in your browser; the code rides inside the link, so nothing is typed on the provider's site | 1 |
| **Sign in once** | You sign in as yourself; Claude reads the key off the dashboard from then on | 1 |
| **Application** | A human at the provider reviews it (Skyscanner, Booking.com) | 1 |
| **Paste a key** | Nothing can obtain it on your behalf | 2 |

Internally each option still declares an ordered ladder — `generate`, `derive`, `detect`,
`mcp`, `authmd`, `register`, `device`, `oauth`, `browser`, `manual` — and `acquire.mjs` walks
it. The five ceremonies above are what that ladder *feels* like from the other side.

Seventeen variables sit at `generate`/`derive`/`detect` and never appear on the page at all.

## Pieces

| Piece | Role |
|---|---|
| `scripts/secrets/registry.mjs` | Single source of truth: slots, their provider options, ladders, probes, and which settings each choice implies. The page is *built* from it, so it cannot describe a route the sandbox won't take. |
| `scripts/secrets/acquire.mjs` | Runs the ladder; writes `.env`; emits `.secrets/outbox.json` (pending ceremonies + status) for the agent to mirror into the page. |
| `scripts/secrets/authmd.mjs` | auth.md client: RFC 9728/8414 discovery of the `agent_auth` block, identity registration (`anonymous`, `service_auth`, `identity_assertion`), JWT-bearer token exchange, and the device-code-style claim ceremony. |
| `scripts/secrets/oauth.mjs` | RFC 8628 device grant, RFC 7591 dynamic client registration, PKCE authorize URLs and code exchange. |
| `scripts/secrets/browser-capture.mjs` | Playwright recipes that read a key off a provider dashboard, plus the one-time sign-in relay that produces the session they use. |
| `scripts/secrets/autofill.mjs` | Everything the sandbox can produce alone. Run it first in any fresh sandbox. |
| `scripts/secrets/verify.mjs` | Probes each configured credential against its provider: live / rejected / unreachable. |
| `scripts/secrets/apply-env.mjs` | Decrypts sealed envelopes into `.env`, printing only names and lengths. |
| `scripts/secrets/bundle.mjs` | Combines envelopes into `.secrets/env.enc.json` — ciphertext, safe to commit. |
| `scripts/secrets/keygen.mjs` | The sandbox recipient keypair. Private half is 0600 and gitignored; agents are denied from reading it. |
| `scripts/secrets/build-page.mjs` | Renders the page from `page/template.html` + the registry + this sandbox's public key. |

## Commands

```bash
npm run secrets:autofill                        # everything that needs no account
npm run secrets:plan                            # what it will do, and what (if anything) you'd click
npm run secrets:acquire                         # do it — no arguments; the repo says what is needed
npm run secrets:acquire -- --slot email         # narrow it to one slot
npm run secrets:acquire -- --all                # include the optional tooling (fal, Stitch, Openverse)
npm run secrets:resume                          # finish ceremonies you have since approved
npm run secrets:verify                          # is what landed actually accepted by the provider?
npm run secrets:authmd                          # which providers publish agent registration today
npm run secrets:page                            # rebuild the artifact HTML after a registry change
npm run secrets:probe                           # which providers let an agent register itself
npm run secrets:probe -- --register             # ...and prove the advertised endpoints work
```

### How the plan is derived

| `need` | Meaning | Slots |
|---|---|---|
| `launch` | `src/lib/env.ts` refuses to boot production without it, or it powers a planned surface | guest email, storage, concierge |
| `feature` | A shipped page degrades honestly without it | database, search, video, travel, rides |
| `tooling` | For us, invisible to guests — needs `--all`, or a press on the page | design imagery |

Choosing an **opt-out** option ("just link out", "codes you print", "skip it") is a real
answer: the slot leaves the plan entirely and nothing is asked about it again.

## The loop, end to end

The page is a status board for work already under way, not a form to complete. Most rows say
*Claude is handling this* and carry no control at all.

1. **Claude runs `npm run secrets:acquire`** — no plan needed, no question asked — and mirrors
   `.secrets/outbox.json` into the page's store. Each credential's status carries a structured
   `nextAction: {method, reason}`, so the page states what is happening in plain language
   without parsing failure prose.
2. **A row grows exactly one button, only where a provider will not deal with software:**
   - **Authorize** — a device or OAuth link. The code is carried inside the link
     (`verification_uri_complete`), so nothing is typed on the provider's site either.
   - **Sign in once** — writes `handoffs/<credential>` to the store. Claude opens the relay,
     you sign in as yourself, and it reads the key off the dashboard from then on. This is the
     path for anyone who has never minted an API key: you only need your own password.
   - **Apply for access** — the two partner applications no endpoint can mint.
3. **Pasting is the last resort, and looks like it.** Every row has a quiet *I already have a
   key* link that reveals its fields in place; a seal bar appears only once something is typed.
   Dropping a `.env` under "If you already have keys" does the whole set at once.
4. **Claude runs `npm run secrets:resume`**, exchanges anything you approved, writes `.env`,
   and reports the variable *names* that landed.

### What the agent must watch

| Store path | Written by | Meaning |
|---|---|---|
| `status/<credential>` | agent | live state + `nextAction` the page renders |
| `ceremonies/<credential>` | agent | a link waiting for a human |
| `choices/<slot>` | **the page** | which provider option is in force; mirror to `.secrets/choices.json` |
| `handoffs/<slot>` | **the page** | `kind: signin` → run `browser-capture.mjs relay <host>`; `kind: link` → start the OAuth/device ceremony |
| `envelopes/<VAR>` | the page | a sealed value to apply |

An authorization-code provider redirects back to the page, which seals the one-time code
with the sandbox's public key — worthless without the PKCE verifier that never left the
sandbox. Typed values survive a status update arriving mid-keystroke.

`npm run secrets:verify` closes the loop: a key that is present but refused is worse than a
missing one, because the app would take the live path and fail in front of guests.

### Importing a .env

The page accepts a dropped, pasted or chosen `.env`. It parses in the browser, shows you the
variable **names** it found, unticks anything the sandbox generates itself, and seals only
what you keep. Nothing legible leaves the tab.

### The browser rung

Where a provider has no agent protocol and no device flow, the agent can still read the key
off the dashboard — but only from a session you established yourself:

```bash
node scripts/secrets/browser-capture.mjs relay console.anthropic.com
```

Chromium runs in the sandbox; the page is the screen and the keyboard, and anything you type
is sealed to the sandbox key, so the password is decrypted in that process and nowhere else.
When you are signed in, the session is saved to `.secrets/sessions/<host>.json` (0600,
gitignored) and every later run drives the dashboard headlessly: open the keys page, press
"Create key", and read the value back **by pattern** (`sk-ant-api…`, `re_…`, `duffel_test_…`)
rather than by CSS selector, because dashboard markup drifts and key formats do not.

## Which providers let an agent register itself

**Ask, don't assume.** `npm run secrets:probe` checks every provider on the ladder and prints
what it found; `-- --register` proves an advertised endpoint actually mints a client, because
advertising one is not the same as honouring it.

An earlier version of this document asserted that no provider supported agent registration.
That was wrong, and wrong in an instructive way: it looked only for WorkOS's `agent_auth`
extension at apex domains. The mechanism the industry actually shipped is **RFC 7591 dynamic
client registration** behind **RFC 9728/8414** metadata — which MCP's auth spec requires — and
most of these providers have it.

Findings on 2026-09-07 (`npm run secrets:probe -- --register`):

| Provider | Registration endpoint | Result | Ceremony |
|---|---|---|---|
| Cloudflare | `bindings.mcp.cloudflare.com/register` | **201 registered** | one link |
| OpenRouter | `mcp.openrouter.ai/oauth/register` | **registers** (PKCE S256) | one link |
| Neon | `mcp.neon.tech/api/register` | **200 registered** (scopes `read write`) | one link |
| Supabase | `api.supabase.com/platform/oauth/apps/register` | **201 registered** | one link |
| Resend | `api.resend.com/oauth/register` | **201 registered** (scopes `emails:send`) | one link |
| Vercel | `api.vercel.com/login/oauth/register` | **201**, loopback redirect only | one link |
| Uber | `auth.uber.com/oauth/v2/register` | advertised; 403 `Missing csrf token` | sign in once |
| fal.ai | `auth.fal.ai/oidc/register` | advertised; "dynamic client registration is disabled" | sign in once |
| Anthropic · OpenAI · Voyage · Duffel | — | no RFC 8414/9728 metadata at any probed origin | sign in once |
| Groq · Mistral · DeepSeek · xAI · Fireworks · Cerebras · Google | — | nothing published | sign in once |
| Together AI | — | OAuth, but no registration endpoint | sign in once |

Every inference provider except Anthropic and OpenRouter runs through
`src/providers/ai-model/openai-compatible.ts` — the OpenAI chat API with `AI_BASE_URL`
pointed elsewhere — so adding one is a registry entry and a base URL, not a dependency.
Browser auth is their default, because none of them publishes anything to register against.

Two lessons are baked into the code as a result:

- **Discovery must follow the whole chain.** A resource's metadata names its authorization
  servers, which are often on a different host — Supabase's MCP endpoint points at
  `api.supabase.com`, and looking only at `mcp.supabase.com` finds nothing.
- **Ask only for grants the server advertises.** Requesting the device grant from a server
  that does not offer it is a 400; that alone made Cloudflare and Resend look unavailable when
  both register happily.

Re-run the probe periodically. When a provider turns registration on, moving its option to a
one-link ceremony is a two-line change in `registry.mjs`.

## Durable key (future sessions self-apply)

1. On the page, open **Keys and sealed envelopes → Durable key**, generate a keypair, and put
   the private half in your Claude Code environment settings as `SECRETS_PRIVATE_KEY`. The
   public half is saved as a recipient automatically.
2. `node scripts/secrets/bundle.mjs <dir> --out .secrets/env.enc.json`, and commit the bundle
   (ciphertext only).
3. The `SessionStart` hook in `.claude/settings.json` runs `apply-env.mjs` whenever
   `SECRETS_PRIVATE_KEY` is present, so `.env` is populated before any work starts.

This matters more than it looks: the sandbox keypair dies with the sandbox, so a page built
for a dead sandbox can seal envelopes nobody can open. A durable recipient is the safety net —
and `npm run secrets:page` re-bakes the current key whenever a new sandbox starts.

## Cryptography

One fresh AES-256-GCM key per value, with the variable name as associated data; that key is
wrapped with RSA-OAEP (SHA-256, 4096-bit) for every recipient; all binary fields base64url.
Both sides use WebCrypto, so the browser and Node produce interchangeable envelopes.

## Threat model in one paragraph

Plaintext exists only in your browser tab and in the sandbox's `.env`. The artifact store and
git history hold ciphertext; the sandbox private key is a 0600 file agents are denied from
reading; the durable private key lives only in your environment settings. Anyone who can open
the private artifact sees variable names, ladder state, and ciphertext — nothing more.
Delegated tokens are scoped by the provider and can be revoked there. A one-time OAuth code
sealed by the page is useless without the PKCE verifier held in the sandbox. Losing a private
key makes its envelopes undecryptable (reseal from the page).

## What this deliberately does not do

- No key values in chat, logs, audit rows, or commits — only names, methods and lengths.
- No scraping a provider dashboard from a session you did not establish yourself.
- No storing your provider passwords: the relay types what you seal and keeps only the cookie
  jar the provider issues.
- A connection string an MCP server returns *has* passed through the transcript. Rotate the
  Supabase database password before real guest data exists.
