# Secrets without the model in the loop ("Secret Drop")

Claude Code on the web cannot change a running container's environment
variables, and pasting keys into chat sends them through the model. This
repo ships a small envelope-encryption flow so keys reach `.env` in the
sandbox as ciphertext only.

## Pieces

| Piece | Where | Role |
|---|---|---|
| Secret Drop page | https://claude.ai/code/artifact/1f7c6ffb-f3f3-456e-8ebb-623f5124782c (private artifact) | Form that seals each value in the browser and stores only ciphertext in the page's private store |
| `scripts/secrets/keygen.mjs` | sandbox | Generates the sandbox recipient keypair: `.secrets/private.jwk.json` (mode 600, gitignored, never read by agents) and `.secrets/public.jwk.json` (public, committed) |
| `scripts/secrets/apply-env.mjs` | sandbox | Decrypts envelopes (from a directory of JSON files or a bundle) into `.env`, printing only variable names and lengths |
| `scripts/secrets/bundle.mjs` | sandbox | Combines envelope files into `.secrets/env.enc.json`, a ciphertext bundle that is safe to commit |

Cryptography: one fresh AES-256-GCM key per value (AAD = variable name);
that key is wrapped with RSA-OAEP (SHA-256, 4096-bit) for every recipient
public key; all binary fields base64url. Both sides use WebCrypto, so the
browser and Node produce interchangeable envelopes.

## What the sandbox fills in by itself

`node scripts/secrets/autofill.mjs` writes every value that needs no account:
random `CONFIRMATION_SECRET`, `CRON_SECRET`, `BETTER_AUTH_SECRET`,
`TEST_AUTH_SECRET`, `DEV_STORAGE_SECRET`; local URLs (`NEXT_PUBLIC_SITE_URL`,
`BETTER_AUTH_URL`, `EMAIL_FROM`); detected binaries (`PW_CHROMIUM_PATH`,
`FFMPEG_PATH`); the assets user agent. It never overwrites a non-empty value
and prints names only. Run it first in any fresh sandbox; the Secret Drop page
does not ask for these.

### auth.md (agent self-registration)

`NODE_USE_ENV_PROXY=1 node scripts/secrets/authmd-discover.mjs` probes each
provider for the [auth.md protocol](https://github.com/workos/auth.md)
(`/auth.md`, `/.well-known/auth.md`, and the `agent_auth` block in
`/.well-known/oauth-authorization-server`). Findings on 2026-09-05:

| Provider | auth.md | Anonymous registration |
|---|---|---|
| Resend | yes | no ("does not support agentic registration"; asks for `RESEND_API_KEY` out of band, which is exactly what Secret Drop does) |
| WorkOS | yes | yes (one-shot environments), not used: auth is Better Auth (ADR-0008) |
| fal.ai, Higgsfield, Openverse, Stitch, Duffel, Skyscanner, Booking.com, Uber, Voyage, OpenAI, Anthropic, Supabase, Vercel, Cloudflare | no protocol file | n/a |

Re-run the probe periodically; when a provider we use adds anonymous
registration, add its flow next to `autofill.mjs` and drop the field from the
page.

### Provisioned services (connected MCPs)

Supabase and Vercel are connected to the Claude session as MCP servers, so a
project can be created from the chat once the cost is acknowledged (Supabase
quoted $10/month for a new project in Tyler's org on 2026-09-05; Vercel
Hobby linking is free). Connection strings they return are written to `.env`
by the agent; rotate the database password from the Supabase dashboard
before real guest data exists, because that first value passed through the
chat transcript.

## Session flow (works today)

1. Open the Secret Drop page, fill in any keys, press **Encrypt and send**.
2. Tell Claude "apply the secret drop". Claude runs, in this order:
   ```bash
   # read ciphertext envelopes from the page's store into files (Artifact tool, read_db … out_dir)
   node scripts/secrets/apply-env.mjs <dir-of-envelope-json>      # decrypts into .env, prints names only
   ```
3. Claude reports the variable names that landed. It never prints values,
   and the agent settings deny reading `.env` and `.secrets/private*`.

Note: MCP servers configured at session start (fal.ai, Stitch) read their
keys from the environment when Claude Code launches, so they pick up new
keys in the *next* session; app code and scripts (`next dev`, `npm run …`,
`scripts/fal-generate.mjs`) read `.env` immediately.

## Durable flow (future sessions self-apply)

1. In the page, open **Durable key for future sessions**, generate a keypair,
   copy the private key, and add it to your Claude Code environment settings
   as `SECRETS_PRIVATE_KEY` (one time). The public half is saved as a
   recipient automatically, so later envelopes are sealed for it too.
2. Ask Claude to bundle the envelopes: `node scripts/secrets/bundle.mjs <dir> --out .secrets/env.enc.json`
   and commit the bundle (ciphertext only).
3. The SessionStart hook in `.claude/settings.json` runs
   `node scripts/secrets/apply-env.mjs .secrets/env.enc.json` whenever
   `SECRETS_PRIVATE_KEY` is present, so `.env` is populated before any work
   starts. Rotate a key by resubmitting it in the page and re-bundling.

## Threat model in one paragraph

Plaintext exists only in your browser tab and inside the sandbox's `.env`.
The artifact store and the git history hold ciphertext; the sandbox private
key is a 0600 file the agent is denied from reading; the durable private key
lives only in your environment settings. Anyone who can open the private
artifact sees variable names and ciphertext, nothing more. Losing a private
key makes its envelopes undecryptable (re-seal from the page). The page has
no analytics, no external requests except Google Fonts for its typefaces.

## What this deliberately does not do

- No browser-automation capture of keys from provider dashboards: that would
  require your provider logins to pass through the agent.
- No key values in chat, logs, audit rows, or commits.
