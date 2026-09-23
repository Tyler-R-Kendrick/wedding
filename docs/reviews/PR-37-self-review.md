# PR 37: Home counts the days, says the theme, and unfolds as you scroll

Sara and Tyler's feedback on the live home page:

- there was no countdown;
- they disliked "Good people / beautiful places / great love";
- the page didn't say the theme, **Love, Peace, & Happiness** (sharing the places and experiences they have been lucky to have with the people they love who have not);
- images looked cut off;
- the lakefront portrait looked haunting and AI-edited;
- the page was static and claustrophobic.

Two reviews ran on the first push: a design review (the `design-reviewer` agent,
at 390, 820, 1100 and 1440, scrolled) and a code review of `origin/main...HEAD`.
This file records what each one found and where it ended up.

## 1. What a hostile reviewer would say

*"You redrew an approved design."*

Yes, at the couple's direction, and every change is in `parity-exceptions.json`:

- PX-25: the theme words replace the generated slogans.
- PX-26: the countdown plate.
- PX-27: the new structure below the hero.
- PX-28: the lakefront portrait is retired.

The approved opening itself survives: the portrait, the invitation beside it, and
flowers at the edges.

*"The other couple portraits are just as soft as the one you removed."*

Partly true. `couple.story.monochrome` is another interim crop. It stays because it
is legible at its source size, and it is now held to six columns so it is never
drawn much larger than that source. The lakefront crop was 2.6× upscaled from a
thumbnail, and nothing can fix that. The briefs for the final portraits are in
`media-briefs.md`, and they still need an authorised image provider (Higgsfield is
not signed in here, and the fal.ai token is rejected).

*"Scroll animation is decoration that costs readers."*

Rules the motion follows:

- Nothing on the first screen fades.
- Nothing rests half-revealed. Reveals are one-shot and time-based, not tied to
  scroll position.
- Only elements that start wholly below the screen are held back.
- Keyboard focus reveals a section at once.
- Reduced motion, no-JS and print get the static page.
- axe is clean at mobile, tablet and desktop, and LCP is the eager hero image.

## 2. Findings and where they went

### Design review (Design 7 · Usability 8 · Creativity 7 · Content 6, "fix first")

| Finding | Outcome |
|---|---|
| **Blocker:** the closing botanical was a cropped corner cut-out standing as a rectangle | Fixed. It is mirrored so its two cut edges lie on the page's top and right edges. The bottom cut fades out with a mask. |
| **Blocker:** "a few of our favorite moments so far" promised photographs `/photos` doesn't have | Fixed. The line now says what the page *will* hold. |
| Story portrait is soft at 7 columns | Fixed: 6 columns. |
| Masthead still said "Brighter together" | Fixed: it reads "Love, peace & happiness", shown from 1600px. At 1440 the longer line pushed the nav into the monogram. |
| "this Saturday in Chicago" read as this coming weekend | Fixed: "on Saturday, July 17, 2027". |
| Section left edges didn't align | Fixed. Everything below the hero starts on one `--bd-col` column. The stepped frame and the theme sprig sit in the margin, and only where a margin exists (≥1360px). |
| A focused link was invisible during its entrance | Fixed: a `focusin` handler reveals the section at once. |
| Hero `sizes` too small at ≥1100px | Fixed: `90vw`. The image covers a box wider than its column. |
| Eyebrow above every section, two repeating their headings | Fixed: "Our theme" and "Shared with you" removed. |
| Copy: "Everyone on our list" sounded like the guest list, and the Peace line was about the website | Fixed: "Every one of you…". Peace is now about slowing down together. |
| `weekend.tsx` still carried "Great people. Beautiful places. Brighter together." | Fixed: the theme. |
| Off-ramp font sizes (advisory) | Kept. Advisory only; the display sizes are fluid clamps as elsewhere in `kit.css`. |
| 390×664: "Our story" sits about 10px under the action bar; the kicker orphans "WEDDING" | Not this PR. The hero copy is unchanged at phone widths, and `main` renders the same. |
| The magenta night skyline reads as stock photography | Kept. It is the ledgered licensed panorama; a couple-supplied photo would replace it. |

### Code review (`origin/main...HEAD`)

| Finding | Outcome |
|---|---|
| Our Story showed `city.river` twice after the memories reshuffle | Fixed. The third memory is `city.riverwalk`. |
| Reveal hid elements already partly on screen (the 92% threshold vs the observer margin) | Fixed. Only elements with `top >= innerHeight` are held. |
| The count plate stayed as an empty frame once the client recomputed "today" | Fixed. `HeroCountdown` owns the plate and returns null on the day. |
| The hero names could spill onto the portrait at 1100–1250px | Fixed. The title clamp is gentler, and the portrait starts at `max(34%, 480px)`. Verified at 1100 and 1440. |
| Without `@property`, the count showed "0 days" for about a second | Fixed. The count-up runs only under `@supports (transition-behavior: allow-discrete)`, which shipped after `@property` in every engine. |
| The city panorama was capped at 70svh with `cover` | Fixed. It is shown whole at ≥900px. |
| `100vw` in the plate offset includes the scrollbar | Fixed. It uses `100%` of the full-width item. |
| `!important` and six `1200px` literals | Fixed: a more specific selector and a `--bd-col` token. |
| `HeroCountdown` duplicated `Countdown` | Fixed: a shared `useDayCount`. |

A first code-review pass ran against a stale local `main` (PR #26). Its findings
(migrations, AI providers, secrets scripts) describe code already on `origin/main`
and are outside this PR.

**Found while fixing:** passing a rest-spread props object into `useCountdown`
re-ran its effect, and so its `setState`, on every render: an infinite loop. The
UI test hung on it. `HeroCountdown` now passes its own props object through, and
a comment says why.

## 3. Evidence

- typecheck, eslint, stylelint, `npm run quality`, and `botanical-deco-media --check` all pass.
- vitest: 1019 tests pass.
- Playwright `themes.spec` and `smoke.spec` (axe, WCAG 2.2 AA) pass at mobile, tablet and desktop.
- The admin and signed-in guest-route specs fail in the sandbox at a sign-in gate, and so does unmodified `main`.
