# Review of the stage pipeline (sitemap → wireframe → skeleton → placeholder → real)

PR 40 built the pipeline: four stage projects, each built from the one before, with the real app
held to the sitemap. This review asks whether the *process* works, not whether the code does:
can the people who have to settle each stage's question reach it, settle it, and notice when it
comes unsettled? It then records what changed, and what is still open.

## What was weak

**1. Nobody could look at a stage without running it.** Four Vercel projects were specified but
never created. Wiring them would have meant five URL variables per project (20 values), kept in
step by hand. The couple, the only people who can settle most of these questions, had no address
to open.

**2. No address to share, and none per pull request.** Even with the four projects, a PR would
have made four separate previews, and a stage had no stable, memorable home.

**3. "Settle each stage's question" had no record.** The rule was stated in `stages/README.md`
and `CLAUDE.md`, but nothing captured *that* a question was settled, *who* settled it, or *for
which version* of the page. The wireframe `status` field was the author's claim, not the
couple's decision.

**4. Changes cascaded to the pages but not to the approvals.** A wireframe edit reached stages
3 and 4 on the next build, which was the design. But any earlier "looks right" silently carried
over to a page nobody had seen since. The pipeline passed changes down; it did not pass doubt down.

**5. No one view of progress.** Where each page stood meant opening four sites and reading
`/wireframes`.

**6. Local and deployed addressing could drift.** Local ports, per-project URLs and (later)
subdomains were three schemes with nothing checking that they agreed.

## What changed

| Weakness | Change |
|---|---|
| 1, 2 | **The wedding app serves the stages.** Nothing new to deploy: the site's own Vercel project builds the stages into `public/_stages/` (`npm run stages:assemble`) and routes to them (`src/lib/stage-hosting.ts`, in `next.config.ts`'s `beforeFiles` rewrites). Each stage is at `<stage>.dev.kendrick.wedding`, and the hub and board are at `dev.kendrick.wedding`. Every pull request's preview carries all four at `/<stage>` and the hub at `/stages`. |
| 1, 6 | **Links come from the address.** `stageHref()` works out every cross-stage link from where the page is viewed (subdomain, path prefix or dev port). The five URL variables are gone. |
| 6 | **Local is the same app.** `npm run stages:assemble && npm run dev` serves `http://sitemap.dev.kendrick.localhost:3000` through the same rewrites. `stage-hosting.test.ts` replays them with Next's own matcher. `npm run stages:probe` asks a running app for every promised address and every asset it references, and CI runs it against `next start` (`stages.yml`, job 5). |
| 3 | **Sign-offs.** `npm run stages:signoff -- <stage> <page> --by <name>` records, in `stages/signoffs.json`, who settled a page at the wireframe, skeleton or placeholder stage, and when. |
| 4 | **Stale sign-offs.** Each sign-off stores the page's wireframe fingerprint. When the wireframe changes, the sign-off reads *stale* until someone looks again. Nothing fails; the board stops vouching for what nobody has seen. |
| 5 | **The board.** The hub shows every page × every stage: wireframe progress, each sign-off (signed, stale or open), and a link into that page at that stage. |

Unchanged on purpose: each stage still develops, tests, typechecks and builds alone, and any
stage's `out/` still deploys to any static host by itself.

Two things surfaced on the way, and both are guarded now:

- Next applies every matching `beforeFiles` rewrite to the previous one's result. So a stage's
  `/icon.svg` was rewritten twice, to a path that did not exist. The rules skip `/_stages/…`, and
  the replay test pins the fix.
- `npm run deploy:vercel` picked the site's public origin (the passkey relying party, and the
  address in every guest e-mail) as the newest custom domain on the project. Attaching
  `dev.kendrick.wedding` would have made that the origin. Stage hosts are now excluded from that
  choice, and the script attaches them in a step of their own.

## Still open

- **Staleness tracks only the wireframe.** A placeholder sign-off does not go stale when a
  design's tokens or the stand-in copy change. Hashing `src/themes/*/DESIGN.md` into stage 4's
  fingerprint would fix that.
- **Feedback has no channel back upstream.** A reviewer who spots a problem at stage 3 has no
  in-page way to file it against the stage that owns it. A "note on this page" link in the stage
  bar, prefilled with stage and page, is the cheap version. It needs a destination the couple
  can use (not everyone has GitHub).
- **Bones are shaped by the wireframe, not by real content.** Once stage 4 has content,
  `boneyard-js build` could capture bones from it, making stage 3's shapes true to length.
- **CI builds each stage three times** (its own job, and twice in job 5). This is fine at the
  current size. If it gets slow, pass the stage jobs' outputs as artifacts.
- **Every deploy of the site now builds the stages** (about a minute, four builds two at a time).
  If that becomes a cost worth avoiding, `--for-vercel` can skip a deploy whose stage inputs did
  not change.
