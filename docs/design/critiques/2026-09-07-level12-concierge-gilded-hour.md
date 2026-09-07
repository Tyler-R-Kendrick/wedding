# Design review — /ask-us `#concierge-slot` (Gilded Hour) — 2026-09-07

Target: `http://localhost:3312/ask-us?theme=gilded-hour` → section `#concierge`,
plaque `#concierge-slot`, island `.cq`.
Files: `src/components/concierge/concierge.css` (shared by both designs),
`src/components/concierge/ConciergeSlot.tsx`, `src/components/concierge/ConciergePanel.tsx`,
`src/themes/gilded-hour/kit.css`, `src/themes/gilded-hour/recipes/ask.tsx`,
`src/themes/gilded-hour/DESIGN.md`.
Widths: 390 / 768 / 1440. States: closed, open-empty, thinking, grounded answer,
three refusals, network error.

## Verdict: FIX FIRST
Scores (1–10): Design **4** · Usability **4** · Creativity **6** · Content **6**
(Ship threshold: all ≥ 7 and Usability ≥ 8 — wedding-site-standards §5)

## Two corrections to the brief
1. `[data-testid="concierge-input"]` is an `<input type="text" maxlength="2000">`, not a
   textarea. `document.querySelector('[data-testid=concierge-input]').tagName` → `INPUT`.
2. The prod server on :3312 stopped mid-review and a dev server came up on :3313. The
   focus-ring, error-state and loading-state probes below ran on :3313 during that window;
   every measurement with a number attached was taken (or re-taken) on :3312.

## Where I agree with the pre-work
`npx impeccable detect src/components/concierge src/themes/gilded-hour` → exit 0.
`npx stylelint "src/components/concierge/*.css"` → exit 0. `design.md lint
src/themes/gilded-hour/DESIGN.md` → 0 errors. axe (wcag2a+2aa+21aa+22aa+best-practice,
scoped to `#concierge`) → **0 violations at 768 in both the answered and the errored
state**, which the pre-work had not covered. Tap targets, the 17px body floor and
horizontal overflow all check out. None of that is re-reported below.
Note the blind spots: axe does not test focus management, live-region coverage, measure,
or the content of an error message — which is where this surface actually fails.

## Blockers (must fix)

1. **The transcript measure at 390px is 19 characters.** `.cq__bubble > p` is 202px wide at
   17px Josefin Sans. DESIGN.md: "Measure stays between 55–72 characters"; standards §7 says
   the same. Four concentric paddings eat 188px (48%) of the screen: section 390 → `.gh-slot`
   350 (padding `--spacing-xl` 40px) → `.cq` 270 → `.cq__log` 268 (padding 16px) → `.cq__bubble`
   236 (padding 16px + 2px rule) → paragraph 202.
   → `src/themes/gilded-hour/kit.css:2101` has no `@media (width < 600px)` override even though
   the file does exactly that for `.gh-plaque`/`.gh-divider` at line ~2118; drop `.gh-slot`
   padding to `--spacing-md` under 600px and zero `.cq__log`/`.cq__bubble` side padding there.

2. **The whole transcript is centre-aligned.** `getComputedStyle(.cq).textAlign` → `center`,
   inherited from Gilded Hour's centred section axis; `concierge.css` never opts out. The FAQ
   directly above it on the same page is left-aligned, and the design's own form component
   does opt out — `.gh-field { text-align: start }` (`kit.css:1040`). Centred multi-line body
   copy at 19ch is unreadable for the primary audience, and it destroys the `[S1]` marker
   column in `.cq__sources`.
   → Add `text-align: start` to `.cq__log` and `.cq__form` in `concierge.css`.

3. **Focus is dropped to `<body>` when the panel opens.** After clicking
   `[data-testid="concierge-open"]`, `document.activeElement` → `BODY`. The button unmounts and
   nothing receives focus, so a keyboard or screen-reader guest gets no signal that a panel
   appeared and must tab from the top of the document to reach the input.
   → `ConciergeSlot.tsx:23` — focus the panel's input (or a panel heading) on mount.

4. **The answer is never announced and never scrolled to.** `.cq__log` has no `aria-live`
   (`getAttribute('aria-live')` → `null`); the only live regions on the page are the route
   announcer and `.cq__meta` (the stage text). A screen-reader guest hears "Looking for the
   right pages…", then silence. Sighted guests fare no better: on Enter at 390×844 the input
   moves from `top: 544` to `top: 1144` — 600px, off a 844px viewport — while `scrollY` stays
   at 5009 and the answer occupies 590–1078, so its bottom half is below the fold.
   → `ConciergePanel.tsx:97` — `aria-live="polite"` + `aria-busy` on `.cq__log`, and
     `scrollIntoView({ block: 'nearest' })` on the new answer turn.

5. **The error state shows a raw browser exception and destroys the question.** Aborting
   `/api/ai/chat` renders `.cq__error` = **"Failed to fetch"**. `ConciergePanel.tsx:84` uses
   `cause.message` whenever `cause instanceof Error`, so the friendly fallback
   ('The concierge is unavailable right now.') is unreachable for the commonest failure —
   the dropped hotel Wi-Fi that PRODUCT.md names as the operating context. Worse: `setQuestion('')`
   at line 54 fires before the request, so after the failure `.cq__input.value` is `''` and the
   guest must retype; the send button is disabled again; and the failed turn leaves an orphan
   "THE CONCIERGE" label above a literally empty `.cq__bubble` (`innerHTML === ""`, from the
   `text ? … : pending ? … : null` ternary at line 102). No retry, no contact — standards §3
   requires "a friendly retry with the couple's contact, never a dead end".
   → Always use the friendly string, restore `question` on failure, render "Try again" +
     "Reach Sara and Tyler", and don't render an empty concierge turn.

6. **Opening the panel collapses the plaque and then over-expands it.** `#concierge-slot`
   height: 327px closed → **106px** during Suspense → 463px open. The fallback at
   `ConciergeSlot.tsx:25` is a bare `<p class="cq__meta">Opening the concierge…</p>` outside the
   `.cq` shell, so the gold plaque shrinks to a third of its height for ~300ms and everything
   below it jerks 221px up then 357px down. Gilded Hour's motion brief is "one choreographed
   reveal per page, then stillness"; this is the opposite.
   → Render the fallback inside the `.cq` shell with a reserved `min-height`.

7. **Every string in the island computes to exactly 17px, so the transcript has no hierarchy.**
   `.cq__who` (the "YOU ASKED" eyebrow), `.cq__meta` ("Based on:", the stage line), `.cq__hint`
   (four lines of small print) and the answer body are all 17.0px at a 17px root. The
   `max(17px, …)` edits in the working copy caused this: `max(17px, 0.8125rem)` = 17px.
   **This is the one place the pre-work's fix is wrong.** The project rule is a 17px floor for
   *body text*; a speaker eyebrow is not body text, and Gilded Hour already defines the role —
   `label-caps: 0.8125rem / 0.18em` in `src/themes/gilded-hour/DESIGN.md`. Held at 17px with
   uppercase and 0.14em tracking, "THE CONCIERGE" is now visually louder than the answer under it.
   → Restore `.cq__who` to the label-caps role token; leave the body/hint at the floor.

8. **`.cq__sources a { display: inline-flex; min-height: 44px }` turns provenance into debris.**
   Measured `.cq__sources li` height at 390: **70px** (44px at 768/1440), and the inline-flex box
   forces "· checked 2026-09-04" onto its own line beginning with an orphaned middot — see
   `[S1]` / "What time does it start?" / "· checked 2026-09-04" breaking over three centred lines.
   **This is the second place the pre-work's fix is wrong**: WCAG 2.2 SC 2.5.8 has an explicit
   *Inline* exception for links inside a sentence or block of text, so 44px was never required
   here and its cost is 26px of ragged space per citation on the primary canvas.
   → Delete the three lines; keep the underline and offset.

9. **Citations and "pages to try instead" are visually identical.** The refusal turns reuse
   `.cq__sources` for onward links, and their only distinguishing label is
   `aria-label="Where to look next"` — invisible. On screen a guest sees "Explore CAA / Our Story
   / Reach Sara and Tyler" in the same bronze underlined list that means "this is where the fact
   came from" two turns above. Provenance stops meaning provenance.
   → Separate class + a visible "Where to look next:" heading, mirroring "Based on:".

## Should fix

- **Per-design values baked into the shared file.** `.cq` / `.cq__button` / `.cq__card` use
  `var(--rounded-sm, 2px)`, but Gilded Hour's `card`, `button-primary`, `button-accent` and
  `button-ghost` roles are all `rounded.none`; only `input` is `rounded.sm`. `.cq__input` uses
  `background: var(--color-neutral)` while `DESIGN.md` sets `input.backgroundColor:
  {colors.surface}`. `.cq__who` hardcodes `letter-spacing: 0.14em` (the root theme's tracking;
  Gilded Hour's label-caps is 0.18em). Introduce `--cq-radius`, `--cq-field-bg`,
  `--cq-label-tracking` role tokens set per design rather than values in the shared file.
- **The island's form does not speak the design's form language.** `.gh-input` (`kit.css:1071`):
  48px min-height, `--color-surface` fill, `:focus { background: var(--color-lake-wash) }`,
  `transition: background-color var(--duration-base) var(--ease-engrave)`. `.cq__input`: 44px,
  neutral fill, no focus fill, no transition. It is the only field on the page that doesn't
  respond like a Gilded Hour field, two sections below the search field it should match.
- **A single-line input for a free-form question.** `maxlength="2000"` in a 202px-wide
  single-line field at 390: anything past ~20 characters scrolls out of sight while you type it.
  A 2–3 row textarea (the design already has `.gh-textarea`) with Enter-to-send is the fix.
- **The white `.cq` card inside the stepped gold plaque is a box in a box.** `.gh-slot` is
  already the card — gold wash, `inset 0 0 0 1px` gold, chamfered `clip-path` corners — and the
  page's own FAQ sets content straight onto its ground. The inner `surface` + `outline`
  rectangle with 2px corners cancels the plaque's chamfer at every corner.
- **Two loading messages at once.** "Working on it…" in the pending bubble and
  "Looking for the right pages…" in `[data-testid="concierge-status"]` 40px below it, saying the
  same thing in different words. Keep the staged one; it is the better idea.
- **An empty `.cq__log` still renders 32px of padding**, so the panel opens with an unexplained
  blank band above "Ask about the wedding".
- **`.cq__hint` — the trust contract — comes after the button** in DOM and visual order, and in
  the ≥40rem grid lands on row 3. It should precede the input.
- **The disabled Ask button is a large flat grey slab** (`opacity: .6` over `--color-primary`)
  and is the default state of the panel's primary action, with nothing explaining why. Prefer an
  enabled button that validates on submit.
- **`.cq__card`'s dashed bronze border collides with the page's own idiom** — the FAQ uses a
  dashed box for "DETAILS TO COME" placeholders, so a confirmation card reads as unfinished.
- **Tab-stop debt**: every citation of every previous answer sits before the input in DOM order.
  Five questions ≈ 15 extra tab stops to get back to the box.
- **`.cq__error` is a lone centred maroon sentence** with no background, border or icon;
  `DESIGN.md` defines `banner-error` (error ground, on-error text, `spacing.md`) for this role.

## Consider

- The `[S1]` markers inside the answer are plain text, while the matching marker in the source
  list is `aria-hidden="true"` (`ConciergePanel.tsx:109`). A screen-reader guest hears "S1" in
  the sentence and can never find it in the list.
- "Based on:" is a `<p>` above an `<ol>` with no `aria-labelledby` tying them together.
- Copy: "The wedding is on Saturday, July 17, 2027 (time zone America/Chicago) [S1]." —
  "(time zone America/Chicago)" is machine-speak against §4 ("Times with time zone if guests
  travel: '4:00 pm PT'"), and the next sentence restates the same date. It reads like stitched
  retrieval rather than the couple's voice.
- "What time does the ceremony start?" answers "Other details are not yet decided by the
  couple" — a non-sequitur; nothing preceded "other".
- The RSVP-deadline refusal offers "Explore CAA" as a next step. Irrelevant.
- Nothing in the island borrows Gilded Hour's vocabulary — no numeral badge on a turn, no gold
  rule between turns, no engraved marginal citation. The design has a strong grammar for exactly
  this (numbered acts, chevron rules, stepped frames) and the transcript uses none of it.

## What is working (keep)

- **The closed invitation state is genuinely good.** One honest paragraph, one square ink
  button, sitting on the plaque. It promises exactly what the thing does.
- **The refusals are the product.** All three land: "not yet decided by the couple" with a
  citation, "I don't have that information yet" with real onward pages, and "That is personal to
  your invitation. Sign in on the website to see it" with a sign-in link. ADR-0003's
  "'I don't have that information' is a success" is honoured, including for the RSVP deadline,
  which it refuses rather than inventing.
- **The staged loading copy** ("Reading what the site knows…", "Checking every sentence against
  its source…") is the one idea here that is *theirs* — it makes the grounding pipeline legible
  and reassuring instead of a spinner.
- **The hint line** sets the right expectations in the couple's voice, including the limits
  ("It cannot book, submit, or change anything").
- Visible label, `aria-describedby` on the input, Enter submits, 2px lake-blue focus ring at 2px
  offset on the open button, the enabled send button and every source link.
- Zero motion in the island means nothing to undo for `prefers-reduced-motion`.

## Evidence

- Screenshots: `/tmp/claude-0/-home-user-wedding/d3fa22fc-6641-5d6b-88a9-feeecbccf930/scratchpad/shots/`
  (`390-closed`, `390-open-empty`, `390-answer`, `390-refusals`, `390-loading`, `390-error`,
  `390-rhythm`, `768-answer`, `re-1440-open`, `repro-1440-1`)
- Detector: `npx impeccable detect src/components/concierge src/themes/gilded-hour` → 0 findings
- stylelint: 0. `design.md lint src/themes/gilded-hour/DESIGN.md` → 0 errors
- axe: 0 violations, `#concierge` scoped, 768px, answered + errored
- Measured: measure 19ch/53ch/53ch at 390/768/1440; `.cq__sources li` 70px at 390;
  slot height 327 → 106 → 463 on open; input top 544 → 1144 on submit at 390×844;
  `.cq__who`/`.cq__meta`/`.cq__hint`/body all 17.0px
- Not reproducible, not reported: an unstyled-island frame appeared in a first capture pass at
  768/1440; four further loads (`repro-*`) plus a polled computed-style trace under 1.6 Mbps
  throttling showed `.cq` styled from the first frame. Capture artifact, not a FOUC.

## Next command

`/impeccable polish src/components/concierge --target /ask-us?theme=gilded-hour`
— take blockers 1, 2, 7 and 8 first: measure, alignment, type scale and the citation block are
one problem, and fixing them makes the rest of the transcript legible enough to judge.
