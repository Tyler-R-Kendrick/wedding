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

## The ladder

Every credential in `scripts/secrets/registry.mjs` declares an ordered ladder. `acquire.mjs`
walks it top to bottom and stops at the first rung that works.

| Rung | What happens | What you do |
|---|---|---|
| `generate` | Random material minted in the sandbox (`CRON_SECRET`, `BETTER_AUTH_SECRET`, …) | nothing |
| `derive` | Computed from another value, the repo, or `git config user.email` | nothing |
| `detect` | Found on this machine (Chromium, ffmpeg) | nothing |
| `mcp` | A connected MCP server provisions it (Supabase, Vercel, Cloudflare) | nothing |
| `authmd` | The agent registers *itself* under [auth.md](https://github.com/workos/auth.md) | nothing, unless the provider asks you to claim the identity |
| `register` | A documented anonymous self-registration endpoint (Openverse) | nothing |
| `device` | RFC 8628 device authorization | open one link |
| `oauth` | Authorization code + PKCE; the Secret Drop page is the redirect target | open one link |
| `browser` | The agent drives Chromium against a dashboard you signed into once | one sign-in, ever |
| `manual` | Paste the value | copy and paste |

Nineteen variables sit at `generate`/`derive`/`detect` and are never shown on the page at
all. Two credentials (Skyscanner, Booking.com) are reviewed partner applications with no
endpoint that can mint a key — those are honestly marked `paste`, and the page says why.

## Pieces

| Piece | Role |
|---|---|
| `scripts/secrets/registry.mjs` | Single source of truth: credentials, ladders, probes, and the outcomes ("send real e-mails") they serve. The page is *built* from it, so it cannot describe a route the sandbox won't take. |
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
npm run secrets:acquire -- --credential resend  # narrow it to one
npm run secrets:acquire -- --all                # include the optional tooling (fal, Stitch, Openverse)
npm run secrets:resume                          # finish ceremonies you have since approved
npm run secrets:verify                          # is what landed actually accepted by the provider?
npm run secrets:authmd                          # which providers publish agent registration today
npm run secrets:page                            # rebuild the artifact HTML after a registry change
```

### How the plan is derived

| `need` | Meaning | Members |
|---|---|---|
| `launch` | `src/lib/env.ts` refuses to boot production without it, or it powers a planned surface | Resend, S3 storage, Anthropic |
| `feature` | A shipped page degrades honestly without it | Postgres, Cloudflare Stream, embeddings, travel, Uber |
| `optional` | Tooling for us, invisible to guests — needs `--all` | fal.ai, Stitch, Openverse |

`alternateOf` groups mean **one is enough**: any embeddings provider, any travel provider.
The queue shows the group once and stops asking as soon as one member lands.

## The loop, end to end

The page is a work queue, not a form to complete. It is useful with **zero** actions: the
sandbox is already walking the list.

1. **Claude runs `npm run secrets:acquire`** — no plan needed, no question asked — and
   mirrors `.secrets/outbox.json` into the page's store, so every credential carries a live
   status chip and anything needing a human carries an **Authorize** button.
2. **You do nothing, or one of two things:**
   - *Have a key already?* Type it in the field on its row and press **Seal and send** once.
     Every value typed anywhere on the page is sealed in that single press. Dropping a
     `.env` does the same for all of them at once.
   - *See an Authorize button?* Press it. The link carries the code inside it
     (`verification_uri_complete`), so nothing is ever typed on the provider's site either.
3. **Claude runs `npm run secrets:resume`**, exchanges anything you approved, writes `.env`,
   and reports the variable *names* that landed.

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

## auth.md today

`npm run secrets:authmd` re-probes every provider on the ladder. As of 2026-09-07:

| Provider | `agent_auth` metadata | auth.md document |
|---|---|---|
| Resend | no | yes — states it does not support agentic registration |
| WorkOS | no (per-tenant, not at the apex) | yes |
| Anthropic, OpenAI, Voyage, fal.ai, Stitch, Duffel, Uber, Cloudflare, Supabase | no | no |

So the ladder is honest about falling through today — and the moment one of these publishes
an `agent_auth` block, `acquire.mjs` picks it up with no code change. What *does* work now
without a human: every `generate`/`derive`/`detect` variable, Openverse's anonymous
registration endpoint, Supabase and Cloudflare through their MCP servers, and Uber's dynamic
client registration (`auth.uber.com` publishes `registration_endpoint`).

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
