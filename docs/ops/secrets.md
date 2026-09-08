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
| AI concierge | **the guest's own browser** · a harness you're signed in to · Anthropic · OpenRouter · OpenAI · Groq · Together · Mistral · DeepSeek · your own Ollama |
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
npm run secrets:harness                         # AI sessions this machine already holds (--apply to borrow)
npm run secrets:probe                           # which providers let an agent register itself
npm run secrets:probe -- --register             # ...and prove the advertised endpoints work
npm run secrets:serve                           # the whole thing as a local web app (no Claude needed)
npm run secrets:coverage                        # the page's decisions, 100% or it fails
npm run secrets:verify:page                     # click all 36 provider choices in a real browser
npm run secrets:verify:lifecycle                # press the buttons and watch the work actually happen
npm run secrets:verify:artifact                 # drive the page as the published artifact, where nothing is behind it
```

### How the plan is derived

| `need` | Meaning | Slots |
|---|---|---|
| `launch` | `src/lib/env.ts` refuses to boot production without it, or it powers a planned surface | guest email, storage, concierge |
| `feature` | A shipped page degrades honestly without it | database, search, video, travel, rides |
| `tooling` | For us, invisible to guests — needs `--all`, or a press on the page | design imagery |

Choosing an **opt-out** option ("just link out", "codes you print", "skip it") is a real
answer: the slot leaves the plan entirely and nothing is asked about it again.

### Why the page's logic is its own module

Everything the page decides — which provider is in force, which ceremony that implies, whether a
control belongs on a strip at all — lives in `scripts/secrets/page/logic.mjs`, not in the HTML.
`build-page.mjs` inlines it (the artifact stays one self-contained file) and the tests import it.

That split exists because the logic was wrong in a way nothing could see. `.secrets/outbox.json`
records which option each ladder run was for; switching provider does not re-run the ladder, so the
old row survives. The page trusted its `nextAction` unconditionally, so after choosing Postmark
(sign in) it still offered Resend's OAuth link — the choice registered and then decided nothing.
A status now speaks only for the option it was computed for.

Three gates keep it honest, and each was checked against the bug it exists for before being
trusted — reintroduce the defect and the gate must go red:

- `secrets:coverage` runs the decisions under Node's own V8 coverage and fails below 100% on
  lines, branches and functions. No new dependency; `node --test` does it, because vitest
  transforms the module before V8 can see it. `npm run quality` runs it, so CI enforces it.
- `secrets:verify:page` starts the server, drives Chromium, and clicks every provider in every
  slot. Its expectations come from the registry's declarations and the page's own rendered text —
  never from `logic.mjs`. An earlier version asked the module under test what to expect, and so
  reported all thirty-six passing while the page was broken. The rule that catches this class of
  bug: a live status may override an option's declared ceremony, but only for the one option it
  was computed for, so two options in a slot rendering someone else's ceremony means the choice is
  not being honoured.
- `secrets:verify:lifecycle` presses the controls against a real server doing real work and
  watches what happens next. It is the gate for a different failure: a control that *reports*
  work rather than doing it. "Asked just now — Claude is on it" was written the instant a
  hand-off record appeared and never changed, because nothing consumed hand-offs — one writer,
  zero readers — and a frozen sentence renders exactly like a working one. Nothing is stubbed:
  the job that runs is the job the page dispatches in earnest, and the assertion is about the
  reporting, not the outcome. Signing in to a provider from a sandbox is expected to fail; a
  failure that is *reported*, with a reason a person can read, is the passing case. It also
  asserts that the run touched nothing outside its fixture store — an earlier version of this
  check spawned the ladder against the developer's real `.secrets/`, because `--secrets` bound
  the server and not the jobs it spawns.

- `secrets:verify:artifact` loads the built page with the artifact runtime's store stubbed and
  walks all 36 options, asserting that none offers a control that queues and that every one ends
  somewhere the page or the person can reach. It exists because the other two checks both run
  against `secrets:serve` — which has a worker — so both were green while the artifact, the home
  people actually open, was the broken one. Reintroduce the bug and it names 87 problems, starting
  with `email/postmark offers "Sign in once" in the artifact — that press queues work nothing claims`.

## Running it yourself: `npm run secrets:serve`

The page has three homes and one codebase. Published as an artifact it talks to the artifact
store and Claude is the courier. **Served locally it needs neither**, which is what a developer
setting up their own checkout actually wants:

```bash
node scripts/secrets/keygen.mjs      # once per checkout — the key the page seals for
npm run secrets:serve                # http://127.0.0.1:4600
```

It rebuilds the page from the live registry on every boot, so what you see is always the ladder
the tooling will really run. Then:

- **Choices, hand-offs and ceremonies** are files under `.secrets/`, not a remote store. Picking
  a provider writes `.secrets/choices.json`, which is exactly what `secrets:acquire` reads.
- **There is no courier.** A value sealed in the browser is POSTed, decrypted here with
  `.secrets/private.jwk.json`, and written to `.env` on the spot. Only the variable name, the
  time and the length are recorded (`.secrets/applied.json`); the value is not kept, returned
  or logged.
- **The ladder runs from the page.** *Fill what needs no account*, *Run the ladder* and *Check
  what landed* are `autofill`, `acquire` and `verify` — the same scripts, with their output
  streamed back into the page.

Opened straight off disk with no server at all, it still works: it seals into a bundle you paste.

### What stops a web page you visit from driving it

The server binds the loopback interface only, mints a token at boot and injects it into the page
it serves, and requires that token plus a loopback `Host` on every `/api/*` call — so a page on
another origin gets `403`, including via DNS rebinding. `/api/run` takes a command *name* and maps
it to argv written in the repo; a string from the request never reaches a shell. Writes are
confined to `.secrets/` and to `.env` by name, and an envelope whose name is not a variable name
is rejected before anything is decrypted.

It is a development tool. Do not expose it beyond loopback, and do not run it on a machine whose
`.env` you would not hand to whoever can reach that port.

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

**Nothing you have already done is ever offered again.** Each control disappears the moment its
work is under way, and is replaced by what is actually true:

| State | What the strip shows |
|---|---|
| You asked for work and nothing has started it | *Asked 3 min ago — nothing has picked this up yet*, plus **ask again** and a line saying who could |
| Something is doing it now | A spinner and *Signing in to account.postmarkapp.com… 40 s ago* |
| It failed | *Failed 1 min ago*, the reason underneath, and **try again** |
| A link is posted and you have opened it | *Opened 1 min ago — waiting for the provider*; the link stays, demoted, because approval can fail |
| You approved and the code came back | *Approved 2 min ago — queued* until something exchanges it, then a spinner, then done or the reason it failed with **start over** |
| The credential is held | The row leaves **Waiting on you** for the manifest, teal, reading `connected · 1/1 held · you approved a link` |

The last row is the point of the others: `status/<slot>` carries how many of the slot's variables
are held and which rung produced them, so "connected" is never something you have to take on
faith after signing in somewhere. Ceremonies at `code-received` are deliberately *not* treated as
open — offering "Approve" for something already approved is the trap this page exists to remove.

### What each home can actually finish

A control may only offer a route the home it is running in can carry to an end. This is not a
nicety: the published artifact is a page with its own origin, no server behind it, and no
guarantee any Claude session is watching. Offering it "Sign in once" wrote `handoffs/<slot>` and
nothing on earth would claim it — a queue with no consumer, which on screen is indistinguishable
from work in progress.

| Ceremony | `secrets:serve` (a worker is behind it) | Published artifact | Opened off disk |
|---|---|---|---|
| `agent` | the ladder runs from the bar | Claude's job; nothing to press | — |
| `link`, browser-runnable | the worker runs the whole ladder | **the page runs it itself**: registers a client, PKCE, opens the link, exchanges the code and seals the token, all in the tab | paste |
| `link`, not browser-runnable | dispatch to the worker | **ask Claude** — `handoffs/<slot>`, per the courier protocol | paste |
| `signin` | dispatch (the headless relay) | **ask Claude** | the provider's key page + a field |
| `apply` | the application page | same | same |
| `paste` | a field | a field | a field |

**The ask is never demoted beneath a key field.** Acquiring a credential is the agent's job; a
field is rung eleven. It is worth writing down how that got inverted once: reasoning that the
published artifact has no server behind it, the artifact was changed to stop asking and to lead
with *"Open Resend"* and a paste field — for a provider that registers an agent client with no
human at all. The error was equating "this PAGE cannot run the ceremony" with "nobody can": the
page is not the acquirer, the agent is, and `handoffs/<slot>` is how the artifact reaches it.
What the artifact genuinely lacks is a guarantee that anyone is listening *right now*, which is a
reason to report an unanswered ask — the strip says so after 45 seconds and offers a way through
*beside* the ask — and never a reason to put the field first.

That correction then over-shot in the other direction, and the second mistake is the more useful
one. Every `link` and `signin` option was made to lead with an ask — and an ask in the published
page reaches nobody unless a Claude session happens to be watching. Pressing *"Get the link"* (a
name describing nothing) wrote a request, rendered a sentence telling the reader to run
`npm run secrets:serve`, and offered *"ask again"*, which filed the identical request. Three
controls, no outcome, and a terminal command the reader does not have.

What was wrong underneath both is that `BROWSER_AUTH` was deciding the wrong question. It records
whether a browser may **read** a provider's registration and token replies; it was being used to
decide whether the ceremony could be **started**. It cannot, because of the three OAuth steps only
two involve CORS at all:

| Step | Needs CORS? | So it happens |
|---|---|---|
| discovery + registration | yes — a `fetch` whose reply must be read | once, at build time, in Node |
| authorization | **no** — a top-level navigation | in the browser, always |
| token exchange | yes | in the browser where allowed, else the courier |

`scripts/secrets/oauth-clients.mjs` registers a public client per `link` option against the
artifact's URL and caches it in `scripts/secrets/oauth-clients.json`. That file is committed on
purpose: these are public clients (`token_endpoint_auth_method: none`), the `client_id` travels in
every authorization URL and is readable in the published page regardless. A client *secret* must
never appear there, and two providers make that a live risk rather than a theoretical one —
Supabase issues only confidential clients, so it is refused before registration; Neon agrees to a
public client and returns a secret anyway, which is dropped. Either way `register()` yields an id
or nothing.

Proven by `secrets:probe --register`, not assumed: Resend, Cloudflare, Neon and OpenRouter all
mint a public client with no human involved, and the published page opens their real authorization
pages. Vercel publishes no registration endpoint. Postmark, Anthropic, OpenAI, Groq, Together,
Mistral, DeepSeek, Voyage, Duffel and fal publish nothing either — so for those, `signin` is not an
agent route being passed over, it *is* the ceremony, and the page starts it at once.

`BROWSER_AUTH` still records what each provider's CORS headers said, with the date, but it now
decides only one thing: whether **Claim** can redeem the code in the tab or has to leave it sealed
for the courier. Claim tries the exchange regardless and treats a blocked reply as the courier's
turn rather than a failure, so a stale entry costs nothing.
**Check the real response, not the preflight**: Neon's `OPTIONS` returns
`Access-Control-Allow-Origin: *` for both its registration and token endpoints while its `POST`
responses carry no such header, so a browser completes the preflight, sends the request and is
then refused the reply. Trusting the preflight would have shipped another button that cannot work.

**A credential can be a session rather than a value.** Higgsfield issues no API key: the vendored
CLI runs its own OAuth and writes a credentials file, and the skills call `higgsfield account
status`. For a while that was treated as a reason the page could not offer the connection — the
same mistake as reading "no CORS" as "the ceremony cannot start". The machine has a shell. An
option may name its own worker with `handoffKind`, `HANDOFF_WORK.cli` maps that to fixed argv, and
`cli-login.mjs` runs the provider's login while `runJob` streams its output into the record the
strip renders — the CLI prints a link, the person approves it in their own browser, and nothing
secret passes through the page. A named worker outranks the self-serve key page, because opening
`higgsfield.ai` would sign you in to the website and leave the CLI with no session: a control that
looks like the ceremony but is not.

**A returning code waits for the ceremony it belongs to.** After a Resend approval that actually
succeeded, both tabs sat on *"Opened just now — waiting for the provider"* for ever. `takeCode` ran
at bootstrap while the `ceremonies` snapshot was still in flight, so the `state` in the URL matched
nothing, the code was filed under `OAUTH_CODE_PENDING`, the ceremony never moved off `waiting` —
and then `history.replaceState` cleaned the URL, leaving the snapshot that arrived milliseconds
later nothing to retry with. The code is now captured once at parse time, redeemed only after the
ceremonies have arrived, and the URL is cleaned only once it is somewhere safer. The artifact gate
grew a pass that seeds a waiting ceremony and delivers the snapshot *late*, because the old stub
answered `onSnapshot` synchronously and no real store does — which is why nothing caught this.

**Every feature has its own connection.** 18 slots, 49 options.

*Identity is first class*, with five alternatives whose ceremonies were probed on 2026-09-08 rather
than assumed. The apex domains are the trap — auth0.com, clerk.com and workos.com all publish
nothing. What they actually run: `mcp.workos.com` registers a client under RFC 7591 **and** offers
a device flow, and `workos.com/auth.md` documents provisioning a one-shot environment with no
account at all, claimed by a person later — so WorkOS asks nobody. `api.supabase.com` registers
(with `auth:read`/`auth:write` among its scopes) but issues confidential clients only, so the
artifact asks Claude. `mcp.clerk.com` has OAuth but no registration, so a client must exist first.
Auth0 registers only per tenant, and a tenant needs a person. Better Auth stays the default and
needs no account at all: its keys are generated here.

*Generated media is image, video and audio*, and it is not stock photography. fal.ai and Higgsfield
are two required connections; **Openverse** — openly licensed real work — is its own slot, and
**Stitch** (screen comps) is its own again. Filing Openverse under "generated imagery" was a
category error: it generates nothing.

*Maps and restaurant links* are their own slots and are complete as deep links: they open whichever
app the guest already has, with no key, no billing and no tracking. *Grouping photos by face* is
deliberately **off** — a decision rather than a gap, because turning it on means processing
biometric data and needs legal review first.

*Photo search* is vector storage: embeddings kept in the database via pgvector. The AI captioning
slot that briefly sat beside it is gone — tagging images with a model is a nice-to-have, not part
of making search work.

**Choosing something never hides anything.** Picking "Just link out" or "Skip it" answers a slot,
which used to make `needsYou` go false and the strip leave *Waiting on you* for a one-line row
further down the page — the card went away from under the pointer, while choosing the provider
immediately beside it did nothing of the sort. One gesture, two completely different consequences,
and the destructive one looked like the harmless one. A slot touched in this page load is now held
where it is (`heldOpen` in `logic.mjs`) and shows that it is settled; the manifest is where things
are on the way back *in*, never somewhere a click can push them. The header count still uses
`needsYou`, so a held strip never makes the page claim someone is waited on. A second rule of the
same kind went with it: `tooling` slots were hidden until a provider had been chosen, which made
the media tooling the site is built with invisible unless you knew to look.

**The media tooling is required, and it is two connections, not one.** fal.ai and Higgsfield do
different jobs — fal.ai generates a still, Soul generates the *same person* across many stills, and
Higgsfield's video models animate them — so they are separate slots with no opt-out rather than
alternatives in one. Higgsfield deliberately seals nothing: its endpoint `mcp.higgsfield.ai/mcp`
does advertise RFC 9728 metadata and mint a client under RFC 7591 (verified 2026-09-08), so it
*could* have an Authorize button, but there would be nowhere to put the token. The vendored CLI
runs its own OAuth and writes a credentials file (`HIGGSFIELD_CREDENTIALS_PATH`), and
`.claude/skills/higgsfield-*` call `higgsfield account status`; no `HIGGSFIELD_API_KEY` is read by
`src/` or `.mcp.json`. Inventing one so the page had a field to show would be the plausible fiction
this repo bans, so the slot has no secret and its rung is `mcp`.

**Nothing queues for ever.** A request nobody has claimed within 45 seconds stops being called
queued: the strip goes back to the route that needs no courier and says, once, that the other one
was never picked up.

**A pending state must name what is pending on.** The page said *"Asked just now — Claude is on
it"* and *"Approved — finishing up"* for a long time, and neither sentence ever changed, because
hand-offs and returned codes had a writer and no reader anywhere. Both now render through one
function that has to be told which of *queued*, *running*, *done* or *failed* is true, and
`secrets:serve` performs the work rather than only recording the request. `npm run
secrets:verify:lifecycle` presses the buttons in a browser and fails if the text does not move.

### What the agent must watch

| Store path | Written by | Meaning |
|---|---|---|
| `status/<credential>` | agent | live state + `nextAction` the page renders |
| `ceremonies/<credential>` | agent | a link waiting for a human |
| `choices/<slot>` | **the page** | which provider option is in force; mirror to `.secrets/choices.json` |
| `handoffs/<slot>` | **the page** | `kind: signin` → run `browser-capture.mjs relay <recipe>` (the record's `recipe`, not its `host`: the host is the brand domain, the recipe is the dashboard the relay drives); `kind: link` → start the OAuth/device ceremony. Patch the record to `running`, then `done` or `failed` **with a reason** — the page renders those four states and nothing else |
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

### The concierge asks for nothing, twice over

The two options above every account are the point of the slot:

1. **The guest's own browser.** Chrome ships a language model behind the W3C Prompt API — a
   global `LanguageModel` with `availability()` and `create()`. `src/lib/ai/browser-model.ts`
   wraps it: no key exists, nothing is billed, and a guest's question never leaves their
   device. It is the recommended option, and the hosted providers are the fallback for
   browsers without it — not the other way round. `NEXT_PUBLIC_AI_BROWSER_MODEL=off` disables it.

   This is wired, not aspirational. The concierge route takes `{ mode: 'evidence' }`, runs
   routing, tool authorization, retrieval and injection quarantine, and stops at the one step
   that needs a model — handing the browser the same closed-world contract and the same
   evidence blocks the server model would have got. The draft comes back as `{ draft }`,
   retrieval runs again, and every sentence faces the same verifier: a device that invents a
   time or a room has that sentence dropped, exactly as a hosted model would.
   See `docs/architecture/ai-grounding.md` §8a. Answers stay cited either way, and any failure
   — no Prompt API, a model still downloading, a prompt that throws or times out — falls through
   to the server, so the option is never a worse experience than not having it.

2. **A harness you're already signed in to.** `npm run secrets:harness` looks for Claude Code,
   Codex, GitHub Copilot and Ollama and reports what it finds; `--apply` borrows the first
   usable session into `.env`:

   | Harness | Where it looks | What it wires |
   |---|---|---|
   | Claude Code | `~/.claude/.credentials.json` | `ANTHROPIC_AUTH_TOKEN` (an OAuth bearer, not `x-api-key`) |
   | Codex | `~/.codex/auth.json` | `OPENAI_API_KEY` |
   | GitHub Copilot | `~/.config/github-copilot/apps.json` | exchanges the GitHub token, then `AI_BASE_URL=https://api.githubcopilot.com` |
   | Ollama | `OLLAMA_HOST` or `~/.ollama` | `AI_BASE_URL` and the first installed model |

   Presence is not a session: this repo's own sandbox has a `~/.claude/.credentials.json`
   holding only MCP OAuth state, so the report distinguishes **usable** from
   **present, none in it** by reading key *names* — never a value. Without `--apply` nothing
   is copied anywhere.

   A borrowed session carries the harness operator's identity, not the site's, so it is for
   local development; production still wants its own key.

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
