# Design re-review — `/rsvp` + `/your-weekend` — 2026-09-06

Branch `claude/wedding-07-rsvp-seating` @ `aa12d71`. Worktree `/home/user/wedding-07`.
Server `http://localhost:3107` (already running, health `{"ok":true,"db":"up"}`); no restart needed,
no source edited. Viewed as the signed-in guest principal (Ada Testhouse, household of three) at
390 / 768 / 1440 px in both designs.

## Verdict: FIX FIRST

Scores (1–10): **Design 5 · Usability 5 · Creativity 3 · Content 4**
(Ship threshold: all ≥ 7, Usability ≥ 8 — `wedding-site-standards` §5.)

Four of the six previous blockers are genuinely fixed and I could measure each one. The fix round
also introduced two new blockers and left one of the six only half-fixed. The net is still not
shippable, but it is a real improvement over a byte-identical Times New Roman page.

---

## 1. Previous blockers, verified independently

| # | Blocker | Status | Evidence I measured |
|---|---|---|---|
| 1 | Not themed; both designs byte-identical | **PARTIAL** | `document.documentElement.dataset.theme` resolves `gilded-hour` / `conservatory` per `?theme=`, and computed faces differ (see #2). But `data-theme` is **absent from the server HTML** — `curl` returns `<html lang="en">` on both routes; the attribute is written by a client inline script at `src/app/(guest)/layout.tsx:41`. Removing the attribute in-page returns `h1` and `body` to `"Times New Roman"` — the original defect verbatim. Rendered text is still byte-identical between designs (`/rsvp` 2331 chars, `/your-weekend` 1647 chars, both themes): the designs differ in type and colour only, not in structure. |
| 2 | Every glyph Times New Roman | **FIXED** | Computed, 390 px. Gilded Hour: `h1` `Cinzel, "Cinzel Fallback", "Times New Roman", serif` @34px; body `"Josefin Sans", "Josefin Sans Fallback", system-ui, sans-serif`. Conservatory: `h1` `Gloock, "Gloock Fallback", "Times New Roman", serif` @34px; body `Spectral, "Spectral Fallback", ...`. Identical to the `/our-story` reference on the same server. Real fallback stacks present. |
| 3 | `impeccable detect` exit 2 on `kicker-above-heading` | **FIXED** | `npx impeccable detect src/components/rsvp src/components/weekend "src/app/(guest)"` → `[]`, exit 0. Repo-wide `npx impeccable detect` → exit 0. `npm run quality` green (design:lint 0 errors, slop:detect exit 0, stylelint clean). No `page__eyebrow` markup remains in either guest tree (`grep` finds only the now-dead rule at `src/components/rsvp/recipes.css:25`). URL mode refused to launch as root; I re-ran it through a `--no-sandbox` wrapper (`IMPECCABLE_BROWSER`) and got `[]` for `/rsvp` and `/your-weekend`, **but** that scan hit the signed-out page (`<h1>RSVP</h1>`, 19942 bytes) because the detector cannot carry the test-auth headers. The source scan is the load-bearing evidence. |
| 4 | Closed-window dead end (23 live inputs, disabled submit) | **FIXED** | Closed via `POST /api/capabilities/admin_set_rsvp_window {"mode":"closed"}` as an owner admin → `{"open":false,"reason":"manual_closed"}`. `/rsvp` then had **0 form controls of any kind** (not 0 enabled — 0 present); focusables were only the four chrome links; an "RSVPs are closed" notice states what is on file, read-only. `/your-weekend` dropped its RSVP CTA. Restored with `{"mode":"open"}` → `{"open":true,"reason":"manual_open"}`, and `/rsvp` re-serves 18 radios. **The window is back open.** |
| 5 | Sub-17px load-bearing text | **FIXED** | Walked every element with its own text node at 390 px: **0 elements below 17px** on either route in either design. Field hint `.fld__hint` 19.125px; status badge `.badge` 19.125px; primary CTA `.btn--primary` 17px / 55px tall; inputs 19.125px (iOS will not zoom). For contrast, `/our-story` on the same server still has 36 sub-17px elements at 390px — so this is a real guest-page fix, not a global change. |
| 6 | `TODO(Tyler & Sara)` rendered to guests, doubled | **PARTIAL** | The raw marker is gone from rendered text on both routes (`/TODO\(Tyler/.test(document.body.innerText) === false`, all four theme×route combinations, open and closed). Two caveats. (a) It still ships in the RSC flight payload on `/rsvp` — three occurrences of `"description":"TODO(Tyler & Sara): what happens..."` in the HTML source. (b) The replacement is not editorial: see New blocker N1. |

### Should-fixes from the previous round

- **Header / skip tap targets** — **FIXED for the header.** At 390 px and 1440 px: `Sara + Tyler` 121×**44**, `Your Weekend` 124×**44**, `RSVP` 49×**44**. Radio inputs are 22×22 but their `.choice__opt` labels are 178×**44** and 221×**44**, which is the real target. **Not fixed for the skip link**: `.wp-skip` measures 148×**42** — 2px short (`src/components/rsvp/recipes.css` `.wp-skip` has `padding: var(--spacing-sm)` = 8px and no `min-height`).
- **Deadline inconsistency** — **FIXED as stated, but the fix chose the wrong half.** `WeekendPage.tsx:43` and `rsvp/page.tsx:30` / `RsvpForm.tsx:155` now fall back to the same sentence. The two pages agree. What they agree on is that no deadline exists — see New blocker N3.

---

## 2. New blockers (introduced by the fix round, or newly visible)

**N1 — The editorial placeholder is ungrammatical, 10 times across the two pages.**
`PLACEHOLDER_LABEL` is `'Sara + Tyler are still writing this'` (`src/components/provenance/Placeholder.tsx:22`) and it is concatenated with hints that were written to follow a colon. What a guest reads, verbatim from `innerText`:

- `Where: Sara + Tyler are still writing this the room is still to be confirmed.` (×3, `WeekendPage.tsx:59`)
- `Dress: Sara + Tyler are still writing this still to be confirmed.` (×3, `WeekendPage.tsx:61`)
- `Sara + Tyler are still writing this how to reach us with a question.` (footer, `(guest)/layout.tsx:60`)
- `Sara + Tyler are still writing this their contact details.` (closed state, `RsvpForm.tsx:184`)

Nine occurrences on `/your-weekend`, one on `/rsvp`. This is worse than the `TODO(...)` it replaced: the marker at least parsed as a marker. → Fix: make the label a lead-in with punctuation (`Sara + Tyler are still writing this — the room is still to be confirmed.`) or rewrite the hints as standalone sentences.

**N2 — Conservatory renders that placeholder stamp at 1.58:1 contrast. axe serious, 9 nodes.**
`.placeholder__label` computes `#d4b24a` on `#eae2ce`, 18.06px, needs 4.5:1. axe (WCAG 2.2 AA) reports 0 violations on both routes under Gilded Hour (`#7a5a16` on `#ede5d6` ≈ 5.1:1) and exactly this one under Conservatory: 1 node on `/rsvp`, **9 nodes on `/your-weekend`**, at 390 and 1440. Root cause: `src/themes/conservatory/kit.css:13` sets `--prov-note-ink: var(--color-soil)` on `.cv` — the theme shell class the guest routes never render — so `provenance.css:83` falls through to `--color-tertiary`, which that same file's own comment calls "pollen … an accent in this theme, **never text**". This is the identical failure mode as the `wp-header` regression the fix round already found and fixed: borrowing shared component CSS without the shell that carries its variables. → Fix: hoist the `--prov-*` slots from `.cv` / `.gh` to `[data-theme="conservatory"]`.

**N3 — Neither page acknowledges that an RSVP deadline exists.**
With `deadlineAt: null`, both pages print `You can change your answers any time while RSVPs are open.` (`rsvp/page.tsx:30`, `RsvpForm.tsx:155`, `WeekendPage.tsx:43`). A guest is told there is no cutoff. Every other unknown on the same page — room, dress, time, contact — is named as a gap; the deadline alone is papered over with a reassurance. `wedding-site-standards` §8 requires the deadline on `/rsvp`; §3 requires it "stated on the form". The date is a legitimate `TODO(Tyler & Sara)` content gate, but concealing the *existence* of a deadline is a design decision, not a content gap. → Fix: `<Placeholder inline>the date we need answers by.</Placeholder>` in the same slot.

**N4 — The closed state contradicts itself in the same viewport.**
Measured with the window closed. `/your-weekend`, two adjacent lines: `RSVPs are closed. If something changed, reach Sara and Tyler.` immediately followed by `You can change your answers any time while RSVPs are open.` (`WeekendPage.tsx:41` vs `:43` — the second is not gated on `window.open`). `/rsvp` has the same clash between the lede (`page.tsx:30`) and the `RSVPs are closed` notice below it. → Fix: gate both fallback sentences on `data.rsvp.window.open`.

**N5 — `RsvpForm.tsx:58` uses the bare class `placeholder`, not the component.**
`<span className="placeholder"> · details to come</span>` collides with `provenance.css:64 .placeholder { display: block; border: 1px dashed … }` (and with a second, different `.placeholder` rule at `recipes.css:87`, both stylesheets loaded on these routes). The inline aside becomes a full-width dashed box whose text starts with an orphaned `·`. At 768px it is the loudest element above the fold and it says nothing. Same orphan-separator bug on `/your-weekend`, where `{' · '}` at `WeekendPage.tsx:60` wraps onto its own line as `· Dress:`. → Fix: use `<Placeholder inline>` and move the separator inside the conditional.

---

## 3. Should fix

- **1440px: the chrome and the content do not share a measure.** Measured: `.wp-header` / `.wp-footer` left 329 width 782 (46rem); `main.page` left 291 width 857 (72ch). The brand hangs 38px left of the `h1`. Introduced by `aa12d71`, which set `max-width: 46rem` on the new header while `.page` was already 72ch.
- **1440px is not designed, only permitted.** One narrow column, 16px gutters at every breakpoint, ~74ch lede (over the 55–72ch standard in §7). `PRODUCT.md` calls 1440 "the showcase".
- **The two designs are one layout in two skins.** Neither theme's kit vocabulary (`gh-*`, `cv-*`) appears on these routes; `/our-story` uses it heavily. `PRODUCT.md › Themes` promises "two complete, switchable designs", and there is no design switcher on the guest chrome at all (`PRODUCT.md`: "switcher visible to everyone until chosen"). Only 5 links exist on `/your-weekend`.
- **The CAA address is not a tap-to-map link** (`wedding-site-standards` §8). It is plain text in the `/your-weekend` lede.
- **Skip link is 42px tall**, 2px under the 44px floor.
- **`You can change your answers any time while RSVPs are open.` appears twice on `/rsvp`** — `page.tsx:30` and `RsvpForm.tsx:155`.
- **`data-theme` should be server-rendered.** The inline `dangerouslySetInnerHTML` script has no nonce and is the single point of failure for the entire visual identity of the two most important guest pages.
- **The closed-state recovery path has no contact method** — honestly placeholdered, but still a dead end for the one guest who most needs help.

## 4. What is working (keep)

- Keyboard and focus are genuinely good: clean tab order, 3px solid focus rings on every stop, all rings within the viewport. `prefers-reduced-motion` measured: card transition `0s`.
- Every visible input is labelled; 0 unlabelled non-hidden controls on `/rsvp` (32 inputs audited). No placeholder-only labels.
- No horizontal overflow at 390 / 768 / 1440 in either design.
- The closed-window rewrite is the right answer, not a patch: zero controls rather than disabled ones.
- Print CSS works — buttons and skip link hidden, `a[href]::after` shows URLs.
- Typed provenance (`placeholder: true` driving the UI, marker confined to the content record) is the correct architecture. Only the rendering of it is wrong.
- Copy that is real is in the couple's voice: "Allergies, dietary needs, mobility or seating needs. We share these only with the caterer and the planner."

## 5. Scores per design

| | Gilded Hour | Conservatory |
|---|---|---|
| **Design 5** | Cinzel small-caps headings over hairline rules give the form real editorial poise at 390/768, but nine dashed sand boxes carry more visual weight than the guest's own RSVP status, and the 1440 chrome misaligns with the content by 38px. | Gloock and Spectral read beautifully and the green pill CTA is the better of the two, but the same placeholder boxes plus a near-invisible stamp make the page look mid-construction. |
| **Usability 5** | Everything except the copy contradictions and the missing deadline is right: 44px targets, 17px+ everywhere, clean keyboard path, axe 0 violations. | Same, minus one serious WCAG 2.2 AA contrast failure repeated 9 times on the page a guest visits most. |
| **Creativity 3** | Nothing here is theirs. No monogram, no `07 · 17 · 27`, no numbered sections, none of the sunburst/chevron/stepped-frame language `PRODUCT.md` names for this theme. | Same. No foliage, no pressed-flower card, no organic asymmetry. The one original idea — a placeholder that names who is still writing — is executed as broken sentences in a dashed box. |
| **Content 4** | Dates carry weekday and year, the address is complete, the household roster and per-person status are specific and true. The gaps are typed, which is right. But they do not read as intentional, the deadline gap is hidden rather than named, and one sentence is printed twice. | Identical content, rendered with the stamp illegible. |

## 6. Would I ship this to 142 guests, half of them over 60, on a phone?

No. It would function — a determined grandparent can complete this RSVP with a keyboard or a
thumb, and that is a real achievement over the previous round. But she would read "Sara + Tyler
are still writing this the room is still to be confirmed" nine times, half of them in gold on
sand she cannot see, and she would come away believing there is no RSVP deadline. Two of those
three problems are an afternoon of work.

## Evidence

- Screenshots: `/tmp/claude-0/-home-user-wedding/d3fa22fc-6641-5d6b-88a9-feeecbccf930/scratchpad/shots/` — `{theme}_{route}-{390,1440}.png`, `gh-rsvp-768.png`, `closed_*-390.png`, `nojs-{true,false}-rsvp-390.png`, `print-rsvp.png`.
- Detector: `npx impeccable detect` exit 0 repo-wide and on the guest trees; URL mode via a `--no-sandbox` wrapper, `[]` for both routes, **signed-out page only**.
- `npm run quality`: green (design:lint 0 errors / 1 info; slop:detect exit 0; stylelint clean; asset ledger in sync).
- axe-core WCAG 2.2 AA + best-practice, 8 runs (2 designs × 2 routes × 390/1440): 0 violations under Gilded Hour; 1 serious `color-contrast` under Conservatory (1 node `/rsvp`, 9 nodes `/your-weekend`).
- RSVP window was closed and **restored to `open`**; verified by re-fetch (18 radios).

## Next command

`/impeccable polish /your-weekend` — start with the placeholder: one label change, one token
hoist (`--prov-note-ink` to `[data-theme]`), one separator move. That clears N1, N2 and N5 and
lifts Content and Usability more than any other single edit.
