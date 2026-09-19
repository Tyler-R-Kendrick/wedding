# Deploying: Vercel + Supabase + Cloudflare R2

The chosen hosting (ADR-0008). **None of it exists yet** — no Vercel project, no
Supabase project, no R2 bucket, no Resend domain. That is not an oversight: each
costs money or requires an account the couple owns, and the site runs completely
without them. This is the sequence for when someone decides to spend it.

Variable-by-variable reference: `docs/ops/environment.md`. What each provider
falls back to when unconfigured: `docs/ops/activation-matrix.md`.

## Order matters

Deploy in this order, because each step needs the one before it.

### 1. The database, before anything else

Supabase Postgres, with the `vector` extension enabled (the concierge and media
search both use it).

- Create the project. Take the **pooled** connection string for `DATABASE_URL`;
  a serverless function opens and drops connections constantly and will exhaust
  a direct pool. The client recognises a transaction-mode pooler (port 6543,
  a `pooler.` host, or `?pgbouncer=true`) and turns prepared statements off for
  it — PgBouncer cannot serve a statement prepared on another connection, and the
  failure arrives as an intermittent error once guests do, not at boot.
- Or skip all of this: `npm run deploy:vercel` installs the Supabase connector
  from the Vercel Marketplace, which provisions the database and writes
  `POSTGRES_URL` into the project itself. The app reads that name as
  `DATABASE_URL`, so no connection string is ever copied by hand and the
  connector stays the owner of the value it rotates.
- The migration chain runs itself on deploy. `vercel.json` sets a
  `buildCommand` of `node scripts/deploy/migrate-on-deploy.mjs && npm run build`,
  which applies `src/db/migrations/` (the whole schema; there is no other source)
  before the build, and **only** when `VERCEL_ENV=production` — the connector writes
  the same `POSTGRES_*` values to preview and development, so an unguarded build step
  would migrate the live database from a preview. It prefers
  `POSTGRES_URL_NON_POOLING`, because DDL through a transaction-mode pooler fails
  halfway. If migrations fail the build fails, which is the point: code deployed onto a
  database without its schema answers 500 on every route.
  Off Vercel, run `npm run db:migrate` with `DATABASE_URL` set.
  One sharp edge: the step keys off `VERCEL`, which the CLI also sets for a local
  `vercel build --prod` — and that pulls the production environment. Run that on a laptop and
  it will apply the chain to the live database. Use `npm run build` locally; `vercel build`
  is for reproducing a deployment, and `--prod` makes it reproduce this too.
  The chain is applied **before** `next build`, so a build that fails afterwards leaves the
  schema ahead of the code still serving. That is the deliberate trade: this app prerenders
  pages that read content tables, so a build compiled against the *old* schema is the more
  likely breakage, and the chain is additive by convention. A destructive migration (a drop
  or a rename) is the case to run by hand, in two deploys, rather than through this step.
- Decide about seeding. `npm run db:seed` writes the brief-derived content and
  is idempotent, but it also writes the placeholder rows. On a production
  database, run it once and then enter the real content through `/admin/content`
  rather than re-seeding.

### Previews share the production database

The connector writes the same `POSTGRES_*` values to production, preview and development, so a
preview deployment does not just build against the live database — it **serves** from it. Real
RSVPs, names and e-mail addresses are one URL away. The build step above refuses to migrate from
a preview, but nothing in the app stops a preview from reading.

What actually keeps that closed is Vercel's deployment protection: this project is set to
`ssoProtection: all_except_custom_domains`, so every `.vercel.app` deployment demands a Vercel
login and only the custom domain is public. **Turning that off makes every preview URL a public
window onto the guest list.** If previews are ever opened up, give them their own database first.

`DB_AUTO_MIGRATE` and `DB_AUTO_SEED` default **off** in production. Leave them
off: `src/db/client.ts` runs them inside `connect()`, which is once per serverless
instance, so on Vercel a migration that runs on a cold start is a migration that runs
while someone is reading the site — and the seed would re-upsert every row on every cold
start besides. The build step above is where a deploy migrates.

To bootstrap an **empty** database from a machine that cannot open a raw Postgres
connection, both flags are still the way: set `DB_AUTO_MIGRATE=1` **and**
`DB_AUTO_SEED=1`, deploy once, then remove both. `DB_AUTO_MIGRATE` alone applies the
schema and seeds nothing, which leaves the tables only `seed()` ever writes — `events`,
the `rsvp_settings` 'current' row, `floor_plans` and the content rows — empty, and the
pages that read them saying the site has not been set up yet. The build step migrates but
never seeds, deliberately: a seed on every deploy is a write nobody asked for.

### 2. Storage

Cloudflare R2, or any S3-compatible bucket.

- Create the bucket **private**. Nothing in it is public; the app signs every
  read.
- Set all five: `S3_ENDPOINT`, `S3_REGION` (`auto` for R2), `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- `MEDIA_PART_SIZE_MB` must be **at least 5** — S3 and R2 both reject smaller
  multipart parts.
- CORS on the bucket must allow `PUT` from the site's origin, or direct uploads
  fail in the browser while the server logs nothing interesting.

Without S3, production refuses to boot unless `STORAGE_SIGNING_SECRET` is set,
because the committed local-filesystem signing key must never sign a real URL.
**On Vercel it refuses either way**: a serverless invocation gets its own
ephemeral disk, so local-fs would accept an upload and lose it, and that is a
failure nobody sees until they go looking for a photograph. Local-fs remains a
real choice on a host with a volume.

### 3. Secrets

Generate these fresh; do not reuse anything from a `.env` that has been on a
laptop.

| Variable | Length | What it protects |
|---|---|---|
| `CONFIRMATION_SECRET` | ≥ 16 | confirmation tokens on every consequential action |
| `CRON_SECRET` | ≥ 32 | the job-runner endpoint |
| `BETTER_AUTH_SECRET` | ≥ 16 | sessions |
| `AUDIT_HASH_KEY` | ≥ 16 | audit fingerprints (derived from `CONFIRMATION_SECRET` if unset) |

`BETTER_AUTH_URL` and `NEXT_PUBLIC_SITE_URL` must both be the **canonical
public origin** in production. Leave them unset for previews: each preview has
its own hostname, one pinned value would make every preview reject its own forms
and pin its passkey relying party to another host, so both are derived from the
deployment (`src/lib/env.ts`, `next.config.ts`) when unset on Vercel. Getting this wrong is the single most common deployment
failure in this codebase: `BETTER_AUTH_URL` sets the passkey relying-party id,
and `NEXT_PUBLIC_SITE_URL` is what the same-origin check compares the browser's
`Origin` against — a mismatch makes every capability POST a 403 with no useful
error.

**Never set `TEST_AUTH_SECRET`.** It is the one variable that can hand a caller
somebody else's session. The code refuses it when `VERCEL` or `CI` is set, but
do not rely on that.

### 4. The application

- `npm run deploy:vercel` does the whole of this section: it creates the project
  linked to the GitHub repository, turns on Fluid compute and the OIDC issuer,
  installs the Marketplace connectors, sets the variables below, and deploys.
  `npm run deploy:vercel:plan` says what it would do and writes nothing. Its only
  credential is the Vercel CLI session, which the Secret Drop's Hosting strip
  acquires (Vercel refuses a self-registered client the device grant; its own CLI
  client is allowed, so `vercel login` runs it and the page streams the link).
- By hand instead: import the repository into Vercel. Framework preset: Next.js.
  The build command comes from `vercel.json`, which runs the migration step before
  `npm run build`. It overrides the dashboard's Build Command, so changing that field in
  Project Settings does nothing — edit the file.
- Set the variables above for **Production**, and separately for **Preview** if
  previews should exist at all. A preview with `DATABASE_URL` pointed at the
  production database is a preview that can publish seating.
- `TRUSTED_PROXY_HOPS` defaults to `1` on Vercel, which is correct behind their
  proxy. Change it only if another proxy is in front.
- Set `ADMIN_EMAILS` to the couple's addresses before the first deploy, or
  nobody can reach `/admin` to grant themselves a role.

### 5. Email

Resend: verify the sending domain, then set `RESEND_API_KEY` and `EMAIL_FROM`.

Until this is done, one-time codes go nowhere — the dev inbox does not exist on
a deployed host, and a guest asking for a code gets a page that says one was
sent. **Do not open the site to guests before email works.** This is the one
mock whose absence is invisible to the person it fails.

### 6. Background work

`vercel.json` schedules **all three** cron routes every five minutes, and Vercel
adds `Authorization: Bearer $CRON_SECRET` to each call itself:

| Path | Why it is its own route |
|---|---|
| `/api/jobs/run` | the foundation's handlers, plus the housekeeping purge it keeps queued |
| `/api/uploads/jobs/run` | media process/derive/sweep are registered in *that* route's module graph only; without it an upload never leaves "Checking" and stale uploads never expire |
| `/api/media-ai/jobs/run` | media index/cluster, likewise; without it the search index never catches up with what was published |

A handler that is not in a route's module graph cannot be run by that route, so
scheduling only the first leaves two queues with nothing to run them — which
looks like a stuck upload rather than a missing cron. The queue is DB-backed and
idempotent, and all three routes return a uniform 401 when the token is absent
or wrong.

There is no in-process poller. Locally, `npm run jobs:run` takes one bounded
batch; nothing else processes the queue.

Nothing on the guest path depends on the runner, so a missed run delays
housekeeping rather than breaking a page.

### 7. Everything else stays mocked

Flights, hotels, ride benefits, the registry, reservations, media AI: leave them
unset. Each falls back to an honest deep link to the vendor who owns the truth,
which is a supported product state, not a degraded one. Turn them on one at a
time, each with a `/admin/providers` check afterwards, using
`docs/ops/activation-matrix.md`.

## Before you call it live

- [ ] `GET /api/health` returns `ok` and, with `HEALTH_TOKEN`, shows the
      provider modes you expect — not one more mock than you intended.
- [ ] Sign in as an admin with a real code, from a real inbox.
- [ ] Claim one real invitation end to end, from the link to the RSVP.
- [ ] Upload one photograph and approve it.
- [ ] `/admin/flags` shows both legal gates **off**.
- [ ] The content backlog is closed, or the lifecycle state is one that does not
      show the pages it blocks. A site that goes live with placeholder text is
      the failure mode this whole project is built to avoid — see
      `docs/content/for-sara-and-tyler.md`.

## Cost, honestly

Vercel Hobby, Supabase free and R2's free tier will carry a 142-guest wedding
site. The things that push past them are video and a long photo tail after the
day. Neither is a launch concern.
