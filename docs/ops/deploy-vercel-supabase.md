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
  a direct pool.
- Run the migration chain once: `npm run db:migrate` with `DATABASE_URL` set.
  The chain in `src/db/migrations/` is the whole schema; there is no other
  source.
- Decide about seeding. `npm run db:seed` writes the brief-derived content and
  is idempotent, but it also writes the placeholder rows. On a production
  database, run it once and then enter the real content through `/admin/content`
  rather than re-seeding.

`DB_AUTO_MIGRATE` and `DB_AUTO_SEED` default **off** in production. Leave them
off: a migration that runs on a cold start is a migration that runs while
someone is reading the site.

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
public origin**. Getting this wrong is the single most common deployment
failure in this codebase: `BETTER_AUTH_URL` sets the passkey relying-party id,
and `NEXT_PUBLIC_SITE_URL` is what the same-origin check compares the browser's
`Origin` against — a mismatch makes every capability POST a 403 with no useful
error.

**Never set `TEST_AUTH_SECRET`.** It is the one variable that can hand a caller
somebody else's session. The code refuses it when `VERCEL` or `CI` is set, but
do not rely on that.

### 4. The application

- Import the repository into Vercel. Framework preset: Next.js. No build-command
  override is needed.
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

A Vercel cron hitting `POST /api/jobs/run` with
`Authorization: Bearer $CRON_SECRET`. Every few minutes is enough; the queue is
DB-backed and idempotent, and the route returns a uniform 401 when the token is
absent or wrong.

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
