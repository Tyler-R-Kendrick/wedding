# PR 24 — level 16: quality

**Branch** `claude/wedding-16-quality` · **Base** `main` @ `59eb3e8` (level 15 + the four guest-truth PRs, #20-#23)
**Diff** 78 files, ~+2,820 / −2,080 · no new dependency, no schema change, no contract change

The carried design debt, the five admin shells, the level-14 review's should-fix list, the computed
font assertion, and the quality sweep the ladder names.

## 1. What a hostile reviewer would say

**"The admin navigation has been rendering in Times New Roman since level 14, and the level that
fixed the console's fonts is the one that left it."** True. `globals.css` sets
`html { font-family: var(--font-text) }`, `--font-text` is defined only under `[data-theme]`, and
the admin tree deliberately never carries that attribute — so the declaration is invalid at
computed-value time on every admin route and `html` falls back to the browser default. Level 14 fixed
`.ops`, which is the page body; the skip link, the four top-bar links, the "all admin screens"
summary and all 21 index links inside it sit **outside** it and kept the default.

Measured, not inferred:

```
$ node scripts/probes/computed-font.mjs - admin /admin
html: "Times New Roman"
    "Times New Roman"                                            <- A.skip "Skip to content"
    "Times New Roman"                                            <- A (top-bar link), SUMMARY,
                                                                    .con-index__label, index links
    "Libre Caslon Display", Georgia, "Times New Roman", serif    <- H1.ops-title "Admin"
```

after `.admin-root`:

```
    Newsreader, Georgia, "Times New Roman", serif                <- A.skip, top-bar links, SUMMARY,
                                                                    .con-index__label, index links
```

**"And the claim journey — the page a guest reaches from a text message — wore the wrong design."**
Also true, and level 15 fixed the symptom next to it. `auth.css` reads
`var(--font-text, var(--font-body-md))`; with no `[data-theme]` above it, both names resolved from
the Tailwind `@theme` block `globals.css` imports **from the default design**, so a guest who had
chosen Conservatory claimed their invitation in Josefin Sans and Cinzel — behind bare family names
with no fallback stack, so a failed webfont dropped the journey to the browser default. The `(auth)`
layout carries `[data-theme]` now; `/claim/verify` resolves `Spectral, "Spectral Fallback", "Times
New Roman", serif` under Conservatory and `"Josefin Sans", "Josefin Sans Fallback", system-ui,
sans-serif` under Gilded Hour.

Both were found by `tests/e2e/typography.spec.ts`, which is item D, and both are exactly the class of
defect it exists for: `check-css-vars.mjs` catches a `var()` nothing defines; this catches a token
that IS defined and resolves to the wrong thing.

**"You changed four exact-list assertions."** Three, and each is in the diff with its reason:
`admin-console.spec.ts` moves from `td:nth-child(2)` to `[data-col="action"]` (the audit table's
columns were reordered, and an index-addressed assertion follows a reordering silently);
`travel.spec.ts` and `transport-gifts.spec.ts` move from the bespoke string
`"Administrator sign-in is required."` to the console's gate — both replacements also assert the
level-1 heading and the absence of the screen's own content, which the strings they replace did not.
`rsvp.spec.ts`'s 44px header check changed shape: see §4.

## 2. Authorization

No capability added, removed or re-authorized. No `auth:` or `exposure:` field touched. The five
shells that merged were **frames**; every screen's gate is now the route's own first statement
(`if (principal.kind !== 'admin') return <ConsoleGate …/>`) instead of being implied by a wrapper
component, which makes the authorization decision visible where it is made. `handoff/AdminShell`
gated inside the shell; `admin-e/AdminGate` did too. Both are gone and the checks are explicit.

`BIOMETRICS_ENABLED` and `PRO_MEDIA_AI_PROCESSING` are untouched: `setReadiness(…, ready: true)`
still has exactly one caller, `admin_enable_biometric_readiness.ts`, still hard-codes
`flag: 'BIOMETRICS_ENABLED'` and still requires a counsel reference, so `PRO_MEDIA_AI_PROCESSING`
readiness remains unopenable through the app. `tests/e2e/admin-console.spec.ts`'s flags test is
unchanged and green.

## 3. Secrets and PII

Nothing new is rendered. `/admin/audit`'s row shape changed — the target leads, metadata is a
key/value list instead of one joined string — and the redaction assertion changed with it, because
the old regex (`/(?:^|[\s·])(?:reason|note|…)=(?!\[)/` over `innerText`) would have passed
vacuously against a `<dl>`, where `innerText` separates key from value with a newline rather than
with `=`. The new form reads `dt`/`dd` pairs and asserts per pair. That is a strengthening, not a
relaxation, and it was the reason for looking.

One `TODO(Tyler & Sara)` marker left `src/`: 121 → 120. It was in the deleted
`components/admin-e/AdminShell.tsx` — "admin sign-in lands with the identity swarm", stale since
level 06. No marker was added, and no fact was invented; command:
`grep -rc "TODO(Tyler" src/ | awk -F: '{s+=$2} END {print s}'`.

## 4. Tests

`npm run verify` exit 0. Unit/UI **630 in 75 files**, integration **308 in 51 files**, evals 1.
`db:generate` reports no schema change, twice.

Both Playwright arrangements green on servers this run started:

| Arrangement | Result |
|---|---|
| production (`next start`, `next start`, PGLITE_MEMORY, RATE_LIMIT_BACKEND=db) | **256 passed / 86 skipped / 0 failed** (2.6m) |
| test-server (`NODE_ENV=test`, SEED_TEST_FIXTURES, TEST_AUTH_SECRET, DEV_INBOX_TOKEN) | **257 passed / 49 skipped / 0 failed** (5.9m) |

Two new specs, both registered in `scripts/check-spec-coverage.mjs` (9 production + 19 test-server =
28 specs), both watched failing against the code they replace.

**`tests/e2e/typography.spec.ts`** — 14 failed / 7 passed before, 21 passed after. Sample failure:

```
Error: /admin · A.skip "Skip to content" fell back to the browser default · "Times New Roman"
Expected pattern: not /^("?Times( New Roman)?"?|serif|…)$/i
Received string:      "\"Times New Roman\""
```

```
Error: text under PRODUCT.md’s 17px floor
+   "/sign-in · BUTTON.auth-button.auth-button-primary · 12.75px · \"Send me a code\"",
+   "/sign-in · P.auth-hint · 15.9375px · \"The one your invitation was sent to.\"",
+   "/claim/verify · A.auth-link · 15.9375px · \"request a new code\"",  (+3 more)
```

**`tests/e2e/quality-sweep.spec.ts`** — the shell test against level 15's `(guest)/layout.tsx`:

```
Error: /rsvp is not inside the gilded-hour shell
Locator: locator('.site.gh')   Expected: 1   Received: 0
```

`tests/e2e/bundle.spec.ts` had a defect of exactly the kind this level is about, and it is worth
recording: the first version summed `content-length`, which `next start` does not send (chunked), so
it measured **0kB against a 400kB budget and reported green**. It reads
`request().sizes().responseBodySize` now and asserts the total is greater than zero, so a budget that
measures nothing fails instead of passing.

`rsvp.spec.ts`'s "every header link meets the 44px target" changed shape deliberately. Its premise —
"the guest layout borrows the public tree's class names without its stylesheet" — is structurally
impossible now that the guest tree renders the design's own `Shell`. Measuring *every* `header a` on
the themed header at 390 includes the link lists the design collapses into its Menu sheet and
elevator panel, laid out at 0×0, so the old form reported `link 0 is under the tap target: 0`. It now
measures every link a phone can actually tap, **in both designs** (it only ever ran in the default
one), and requires the collapsed header to still offer at least one.

## 5. Threat model

No new route, table, external call or secret. The one security-relevant change is the audit table's
markup, covered in §3. Cache isolation gained coverage rather than behaviour: three identities on one
personalized URL get three different bodies and no ETag (test-server), and `private, no-store` is
asserted on six paths against `next start` (production).

**A finding for the proxy's owner, not fixed here.** `src/proxy.ts` does
`response.headers.append('Vary', 'Cookie')` on personalized and theme-resolved routes, and that
header **never reaches the wire**: Next.js sets its own `Vary` for the RSC protocol
(`rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding`)
and the appended value is lost. Measured on `next start` on all seven paths. The guarantee still
holds on `no-store` alone — a response no cache may store cannot be served to the wrong identity —
so this is dead code rather than an exposure, and `security-headers.spec.ts` says so in place of
asserting a header the app does not send.

## 6. Design

### Carried debt

| | Before → after, measured, same probe |
|---|---|
| A1 guest tree on the theme Shell | `/rsvp` shell `site` / `wp-header` / `wp-footer` → `site gh` / `gh-header` / `gh-footer`; one `<main id="main">`; axe 0 on 8 guest routes × 2 designs |
| A2 measure | Gilded Hour body copy **74–83 → 63–69** characters a line at 1440; Conservatory **71–78 → 62–69**; `/transportation` `.measure` **91 → 64**; `.cv-stat__value` **104 → 57** |
| A3 caps floor | sub-17px kinds on 6 public routes: Gilded Hour **44 → 15**, Conservatory **17 → 3** (all remaining are DESIGN.md's named ornament roles); admin console, 12 screens: **122 → 0**; auth, 6 routes: **10 → 5** |
| A4 concierge transcript | unbounded → capped at 12 turns, trimmed where turns are added, with a line saying how many are no longer shown |
| A5 concierge role tokens | shared `--rounded-sm` / `--color-neutral` → `--cq-control-radius` and `--cq-input-fill` per `[data-theme]`: Gilded Hour `rounded.none`, Conservatory `rounded.md`, both filling on `--color-surface` like their own inputs |

The commands, so the numbers can be taken again (any server; `VW` sets the viewport):

```
VW=1440 node scripts/probes/measure.mjs gilded-hour  none / /our-story /the-wedding /travel /gifts
VW=1440 node scripts/probes/measure.mjs conservatory none / /our-story /the-wedding /travel
        node scripts/probes/min-font-size.mjs gilded-hour none / /our-story /the-wedding /travel /gifts /ask-us
        node scripts/probes/min-font-size.mjs -  admin  /admin /admin/audit /admin/jobs /admin/flags …
        node scripts/probes/min-font-size.mjs -  none   /sign-in /sign-in/admin /claim/verify /claim/passkey /claim/welcome /step-up
        node scripts/probes/stat-strip.mjs /admin/jobs /admin/providers
        node scripts/probes/overflow.mjs   -  admin  /admin/events
        node scripts/probes/axe.mjs        -  admin  /admin …          (25 routes)
        node scripts/probes/bundle.mjs / /the-wedding /ask-us          (next start only)
```

Each "before" was taken by reverting the one token the change moves — `--type-control-caps-size`
back to the ornament step, `--text-body-sm` back to `0.9375rem`, `--gh-measure` back to
`--gh-prose` — and re-running the same command, so the figures isolate the change rather than
comparing two different trees.

The measure is a **DESIGN.md** change, not a CSS override: each design's Layout section now names the
column and the measure as two numbers and says why neither is a `ch` (a `ch` is the advance of "0",
and against Josefin Sans a 70ch cap resolved to the same 714px the 42rem column did, so the cap that
was supposed to hold the measure never bound). The caps floor is a **type-scale** change: all three
DESIGN.md files gain a `control-caps` style at 1rem for caps a guest must read or operate, while
`label-caps` keeps the ornament step, and the root DESIGN.md's `body-sm` goes 0.9375rem → 1rem —
which retires level 14's B6 patch, that had raised four selectors and left the token beneath them
under the floor.

### The five shells

Every screen in `/admin` is on `ConsolePage`. `media/MediaShell`, `handoff/AdminShell`,
`admin-e/AdminShell`, `media/AdminMediaNav`, `mediaai/AdminAiNav` and `content/admin-content.css`
(192 lines) are deleted; `OpsPage` folded into `ConsolePage`. `SubNav`, `Breadcrumbs`, `Empty`,
`Note`, `Radios`, `ScrollRegion`, `Stamp` and `Day` are the console's own. The guest RSVP kit
(`components/rsvp/fields`, `.card`, `.sec`, `.tbl`) is no longer imported by any admin route.

25 admin routes at 390px: **0 axe violations**, one `<h1>` and one `<main>` each, no horizontal page
scroll.

### The level-14 should-fix list

| | Before → after |
|---|---|
| `.con-stat` label drift on a wrapped row | 15px → 0px (`align-content: start`); `scripts/probes/stat-strip.mjs` |
| raw UTC ISO timestamps | `2026-09-08T05:37:32.912Z` → `Sep 08, 2026, 00:37:32 CDT`, one formatter, `<time dateTime>` keeps the instant |
| `console.css` 24×24 comment | now names the three selectors it covers and points at the spec that measures the rest |
| `DataTable` announcing its name twice | `role="region" aria-label={caption}` removed; `<caption>` is the name, once |
| empty table = focusable scroll region | no table at all: a caption and an announced sentence. Dropping only the `tabIndex` was worse — the header row still overflowed, and axe then reported `scrollable-region-focusable` on a region a keyboard could no longer reach |
| `/admin/audit` at 390 | the subject leads the row (`admin_media_metrics`, not a 25th `capability.invoked`), metadata is a `<dl>` |

### Found on the way

`.sr-only` labels inside a scroll region escaped it — an absolutely positioned element is clipped by
an `overflow` ancestor only when that ancestor is also its containing block, and these had no
positioned ancestor. On `/admin/events` they sat at their static position 445px out and made the
**document** report `scrollWidth` 446 against a 390 viewport: invisible, unscrollable (`html` is
`overflow-x: clip`), and precisely the measurement level 14 used to certify that admin screens never
scroll sideways. `.ops-table-wrap` is `position: relative` now; 446 → 390.

### Round two — what the independent review measured that this file did not

The review returned FIX FIRST on the guest tree with seven blockers. Its first one — `/rsvp` telling
a signed-in guest "RSVPs are closed. Thank you — the guest list has gone to the venue" while the site
is in TEASER and RSVPs had never opened — was fixed by the lead before this round began, and
`RsvpForm.tsx`'s `RsvpClosed`/`closedCopy` and `WeekendPage.tsx`'s window branch are untouched here.
The only change near them is the `<GuestSection>` / `<GuestNotice>` frame those states now render
inside, which is B2.

| | Before → after, measured, same probe |
|---|---|
| B2 the page BODY wears the design | themed elements inside `<main>`: `/rsvp` **0/11 → 51/201** (Gilded Hour) and **40/190** (Conservatory); `/your-weekend` **0/84 → 30/101** and **26/97**; `/transportation` **0/60 → 19/84** and **20/85**; `/trip` **0/144 → 19/148** and **20/149**. The two designs' element counts now differ on every route, which the count alone cannot prove — `quality-sweep.spec.ts` also compares the tag sequence inside `<main>` between designs |
| B3/B4 unscoped token reads | **21 → 0** findings, `node scripts/check-theme-tokens.mjs` |
| B5 measure in the guest tree | `/transportation` **91 → 64** characters a line, `/trip` **88–95 → 66–73** |
| B6 `impeccable detect <url>` | see below — it now runs, and it found six things this file had not |
| B7 `.cv-stat__label` | label drift **15px → 0px**; `.cv-rail` clientWidth/scrollWidth **255/266 → 306/306** |
| provenance badges | raised to `control-caps` (17px) and the comment that asserted an ornament role no DESIGN.md grants is replaced with what the three documents actually say |
| PRODUCT.md's route table | `/story`, `/adventures`, `/ask`, `/claim` → `/our-story`, `/our-adventures`, `/ask-us`, `/claim/verify`, with a paragraph on the drift; `tests/e2e/links.spec.ts` now walks that table so it cannot rot again |

**B6 is the one that mattered.** `npm run verify` runs `impeccable detect .`, a FILE scan. The URL
detector drives a browser, and it takes no `--header` and no `--cookie` — while the canonical test
principal is honored only through `x-test-auth` / `x-test-principal` headers. So the four routes the
review was about were the four the gate structurally could not see. `scripts/probes/auth-proxy.mjs`
forwards to the test server with the headers attached:

```
node scripts/probes/auth-proxy.mjs 3317 A1        # guest
node scripts/probes/auth-proxy.mjs 3318 admin     # console
npx impeccable detect --viewport 390x844 http://localhost:3317/your-weekend?theme=conservatory
```

What it found, all six of them mine, all from this level:

| Finding | Where it came from | After |
|---|---|---|
| `[kicker-above-heading] kicker "For you" above h2 "Your ride home"` | the eyebrow I put on `GuestSection`; 15 call sites | the prop is gone. impeccable's craft floor bans a kicker above a heading with no exception — "no brief earns it back" — and all three DESIGN.md files ask for one. Each kit's file records the conflict; reconciling the documents is a DESIGN.md change and is not this level's |
| `[side-tab] border-top: 3px` × 12 on `/rsvp`, × 5 on `/your-weekend` | my `.cv-gcard` / `.cv-gnotice`. The 3px kraft thread along the top was itself the SECOND attempt, after `detect .` refused a 4px bar down the left | an edge is an edge. Ground plus a 1px frame on all four sides; the tone rides the frame |
| `[wide-tracking] letter-spacing: 0.08em on body text` | Conservatory's `control-caps`, which this level authored at 0.08em. It reaches capitals through `smcp`, not `text-transform`, so at 17px the detector reads it as body text — correctly | 0.05em, in `src/themes/conservatory/DESIGN.md` and re-synced. Gilded Hour keeps 0.12em because it does shout uppercase |
| `[cramped-padding] 4px vertical padding` × 22 on `/share-an-adventure` | `.cv-chip` at body size on a filled ground | `--spacing-sm` / `--spacing-md`; 8px alone still failed the horizontal axis at `need ≥ 8.5px` |
| `[cramped-padding] 0px vertical padding` on `/media/upload`, `[line-length] ~134/~132/~105 chars/line` on `/media/me`, `/media/mine`, `/media/upload` | `.media-button` leaned on `min-height` for its inset; `.media-dropzone__hint`, `.media-upload-row__meta` and `.mi-notice` had no measure at all | real padding, and `--wp-measure` — the active design's own reading measure |
| `[low-contrast] pixel contrast 1.1:1 median 2.1:1 (need 4.5:1)` on "Approve and publish" | `.media-button:disabled { opacity: 0.55 }` | a muted ground and outline. WCAG exempts inactive components, so axe never saw it — but the bulk-action row is disabled until something is selected, so unreadable words are the first thing `/admin/media` shows |

The console had never been scanned by the URL detector either. Through the admin proxy it returned
**236 findings over all 36 page × design × viewport combinations**; the real ones are now zero:
`.con-scroll` had no inset so tables ruled against their own frame (24), `<caption>` and `.ops-button`
and `.con-pill` shouted 25–44-character sentences in uppercase (24), and `.ops-lede`, `.ops-h2`,
`.ops-notice` and the console's lists had no measure (14).

```
$ for VP in 1280x800 390x844; do for D in gilded-hour conservatory; do for P in /admin /admin/guests \
    /admin/rsvp /admin/events /admin/media /admin/seating /admin/content /admin/concierge /admin/travel; do
    npx impeccable detect --viewport $VP "http://localhost:3318$P?theme=$D"; done; done; done
before: 190 text-occlusion · 24 cramped-padding · 24 all-caps-body · 14 line-length · 8 em-dash · 4 low-contrast
after:  202 text-occlusion · 8 em-dash
```

**The 202 that remain are a false positive, and this is the one finding I did not act on.** The
console's "all admin screens" navigation is a closed `<details>`. Chrome gives closed
`::details-content` `content-visibility: hidden`, which skips PAINTING but keeps LAYOUT — deliberately,
so find-in-page and fragment navigation can still reach inside and open it. The detector's occlusion
rule compares rectangles without asking whether an element renders, so it reports the invisible nav
copy as "covered by" whatever the reader can actually see at those coordinates.

```
$ node scripts/probes/occlusion.mjs /admin/guests
INVISIBLE  547x31 at 45,118       closed<details>=true  "The site"
INVISIBLE  547x26 at 45,195       closed<details>=true  "What state guests see, what "
…
47 of 47 nav elements have a laid-out box and checkVisibility() === false.
```

The change that would satisfy it is `display: none` on closed `<details>` content, which takes 21
admin links out of find-in-page. That is a real regression traded for a scanner's exit code, so the
finding is recorded in `scripts/probes/occlusion.mjs` rather than acted on, and the console is the
one surface where `impeccable detect <url>` still exits 2. **The lead should decide** whether that
warrants a `detector.ignoreRules` entry; suppressing the rule repo-wide would hide real occlusions
elsewhere, so I did not add one.

Final state of the URL detector, on servers this run started:

| Set | Pages × designs × viewports | Result |
|---|---|---|
| public + auth | 12 × 2 × 2 = 48 | **48 clean** |
| signed-in guest tree | 4 × 2 × 2 = 16 | **16 clean** |
| media | 4 × 2 × 2 = 16 | **16 clean** |
| admin console | 9 × 2 × 2 = 36 | 36 report only `[text-occlusion]` (artifact above) and `[em-dash-overuse]` (advisory, not counted) |

## 7. Accessibility and performance

axe 0 serious/critical across 25 admin routes, 8 guest routes × 2 designs, and 6 auth routes.
Keyboard: the first Tab is the skip link on every guest route in both designs, it lands focus in
`#main`, twenty stops each show a visible indicator, there is no positive `tabindex` and the path
runs forwards through the document. `prefers-reduced-motion: reduce` leaves nothing above 200ms
anywhere in the guest tree, checked over every element rather than a list of selectors.

Client bundle, measured against `next start` (`scripts/probes/bundle.mjs`, fresh context per route,
`responseBodySize`): `/` **141kB over 7 scripts**, `/the-wedding` 143kB/8, `/ask-us` 143kB/8. Budgets
are 300kB/20, roughly double. The concierge island is proved absent from the home page's first view
by reading the delivered sources for the panel's own markers, not by guessing at chunk names.

## 8. What I did not do

- **The rendered flag-off paths.** `/ask-us` with `AI_CONCIERGE=off` and the page with
  `WEBMCP=off` are not exercised in a browser. Flags are read from the process environment at
  startup, both Playwright arrangements share one server each, and `check-spec-coverage.mjs` has
  exactly two arrangements by design — so a third server is the only honest way, and adding one is a
  CI change bigger than the coverage it buys. Both are covered at the unit and integration level
  (`tests/unit/capabilities.test.ts`, `invoke.test.ts`, `webmcp/manifest.test.ts`,
  `identity/resolver.test.ts`). What the sweep covers instead is the path a guest actually gets when
  the model is unavailable or script never loads: Ask Us answering from server-rendered prose.
- **Degraded providers as a browser journey.** `travel.spec.ts` already asserts the fallback ladder
  and the honest unavailable state through the capability route, and the provider mode is read from
  `/api/health` there. Duplicating it as a rendering assertion would restate a covered guarantee.
- **The upload interruption.** `media-upload.spec.ts` owns it and is unchanged; it needs
  `MEDIA_PART_SIZE_MB` to mean anything, which the arrangement sets.
- **`--font-text` for the admin tree.** `.admin-root` sets the family from the foundation token
  rather than teaching `globals.css` about unthemed surfaces, because that rule is in `layer(base)`
  and `foundation.css` is unlayered: a `:root` fallback there would beat every `[data-theme]` block.
  Left as a note for whoever owns the theme engine.
- **A rendered Conservatory "before" for the guest tree.** Both designs' before/after numbers above
  come from re-measuring with the changed token reverted in place, which isolates the change; I did
  not re-render the base commit's five-shell tree to compare.
- **The eyebrow everywhere else.** `PageIntro` still sets one above the `<h1>` on nine merged public
  pages, and all three DESIGN.md files still name an `eyebrow` component. The URL detector does not
  flag those, and removing a component three design documents describe is a DESIGN.md change, not a
  quality sweep. What this level did was stop ADDING them: the 15 I had put on the guest sections are
  gone. The conflict between the craft floor's ban and the three documents is written into
  `src/themes/<id>/guest.tsx` for whoever reconciles them.
- **`impeccable detect <url>` in CI.** The sweep above runs from a shell against servers started by
  hand, and the guest and console halves of it need `scripts/probes/auth-proxy.mjs`. Wiring that into
  `design-quality.yml` means a third server arrangement and a header-injecting proxy inside CI, which
  is a workflow change I would rather propose than make at the end of a level. The static
  `impeccable detect .` still runs in `verify`, and `scripts/check-theme-tokens.mjs` is now a CI step.
- **`text-occlusion` on the console.** Described above: proven to be a rendering-agnostic rectangle
  comparison against `content-visibility: hidden` content, left in place rather than silenced.

## 9. Verdict

**Ready to merge.** `npm run verify` exit 0; `db:generate` no drift, twice; both Playwright
arrangements green on servers this run started — production **257 passed / 88 skipped**, test server
**260 passed / 49 skipped**, both exit 0; 28 specs, each in exactly one arrangement;
`node scripts/check-theme-tokens.mjs` exit 0; `impeccable detect <url>` clean on 80 of 116 page ×
design × viewport combinations and reporting only the `text-occlusion` artifact and the em-dash
advisory on the other 36.

**The worst true thing about this diff** is that it is large, and most of it is a refactor — eighteen
admin screens moved onto one shell in one change. The mitigation is that the shell they moved to was
already the reviewed one, that every screen is asserted to render its own `<h1>` and be axe-clean at
390 afterwards, and that the two behaviours a refactor can quietly break — the gate and the audit
trail's redaction — both gained assertions rather than keeping the ones that would have followed the
markup.
