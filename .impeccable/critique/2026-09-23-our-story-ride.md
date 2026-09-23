# Design review: /our-story, the ride section (redesign), 2026-09-23

Scope: `src/themes/botanical-deco/kit/StoryRide.tsx`, `src/themes/botanical-deco/ride.css`,
`src/themes/botanical-deco/recipes/story.tsx`. The hero and "Places that shaped us" are out of scope.
Server: http://localhost:3001 (dev). Viewports: 390x844, 820x1180, 1440x900, 1280x720.

## Verdict: FIX FIRST
Scores (1-10): Design 8 · Usability 7 · Creativity 9 · Content 5
(Ship threshold: all >= 7 and Usability >= 8, per wedding-site-standards §5.) Content is capped by
TODO(Tyler & Sara) placeholders and stand-in photos (the Paired timeline is not imported yet). That
is not counted against the implementation, which labels every stand-in and credits every photo.

The redesign does what the couple asked. It is ivory, gold-hairline and Bodoni/Newsreader
throughout. The car card is horizontal at every size. Every moment fits its window at all four
sizes. No line is named. Words lead on every card. Words never overlap, and it runs at 60fps. Two
things hold it back: one reproducible detector finding, and one usability bug in the accessibility
escape hatch.

## The couple's seven asks

| # | Ask | Result | Evidence |
|---|---|---|---|
| 1 | Smooth, matches Botanical Deco, not a separate train backdrop | Met | Ivory `ride-stage`, gold hairline rules and photo frames, italic Bodoni titles, Newsreader prose; no dark stage, rails or skyline |
| 2 | Horizontal car card; full angled names on tall desktops, compact strip with only the current name on phones and short windows | Met in ride mode; see S6 for flat mode | 16 names drawn at 820x1180 and 1440x900; 1 at 390x844 and 1280x720 |
| 3 | Line visible in the first viewport; pinned stage fits; moments never overflow | Met; see S3 for the phone label | Map bottom at first load: 805/844, 955/1180, 748/900, 664/720. Docked, 16 of 16 stops fit at every size, none tight and none overflowing |
| 4 | No "Red Line", "Blue Line" etc. | Met | `/(Red\|Blue\|...) Line/` absent from `body.innerText` at every size and state |
| 5 | Words first with visual focus; image to the right (wide) or below (phone) | Order met everywhere; focus weak at 1440x900 and 1280x720 (S1) | e2e check plus bounding boxes |
| 6 | Words never overlap between moments; smooth frames | Met for words; pictures double-expose briefly (S2) | 30 scrub samples at 12px steps: never two moments' words at >2% opacity. rAF p95 16.8ms for Next, express jump and wheel; no long animation frames |
| 7 | Docked: only that moment is on stage | Met | Every docked probe: exactly one stop with text or media opacity >1% |

## Blockers (must fix)

1. **[impeccable rendered detector] 8x `text-occlusion` at 1280x720.** Hits `span.bd-ride-map__name`
   ("Allison and Jamie's wedd…", "Our life together", "Museum of Ice Cream", …), each reported as
   "covered by `article.bd-stopcard--chapter`". Reproduced 3 of 3 times with
   `npm run slop:detect:rendered -- --viewports 1280x720 /our-story`. 390x844, 820x1180 and 1440x900
   are clean. The same URL scanned alone is clean. My own foreground probes found no overlap at 1280x720,
   either by hit test or by rectangle intersection, at load, over the first 2s, or after scrolling.
   The hit names are the 1px `clip-path: inset(50%)` non-current names in the compact strip. So this
   is most likely a scanner-state artifact, but under the pipeline rules it blocks until it is fixed
   or waived.
   → Fix at the root: in compact mode give each `.bd-ride-map__link` an `aria-label` of name plus
   date (StoryRide.tsx:637-650), and hide non-current `.bd-ride-map__name` with `display: none`
   instead of the 1px clip (ride.css:865-871). The alternative is a waiver scoped to `**/our-story*`
   in `.impeccable/config.json`, with this measurement in detector-waivers.md, the way /your-weekend
   was handled.

2. **[usability, a11y] "Read it as a list" and "Ride the line instead" lose the guest's place and
   scroll the focused control out of view.** The code stores the choice and keeps the numeric scroll
   position. Tested with instant scrolls:
   - 1440x900, docked at Starved Rock, switch to the list: the guest lands on The proposal through
     The Loop, and the focused toggle is 6,295px above the viewport.
   - 390x844, same switch: it lands near Starved Rock only by accident, and the toggle is 6,476px
     above.
   - From the list at The proposal, switch back to the ride: 1440 docks at Love and 390 docks at
     The Loop.

   This is the escape hatch for motion-averse and older guests, who are a primary audience. It is
   what holds Usability at 7.
   → In `chooseList` (StoryRide.tsx:154-161), record `stops[at.index].slug` (or the flat stop
   nearest the top). After the mode flips (a layout effect on `ride`), call `go(index, true)` in ride
   mode, or `getElementById(slug).scrollIntoView({block:'start', behavior:'instant'})` in flat mode.
   In flat mode, move focus to that stop's `<h3>` with `tabIndex=-1`, because the toggle is no longer
   on screen.

## Should fix

S1. **[req 5] Words lose visual focus on wide windows.** At 1440x900 the full car card leaves a
    535px window. That trips `@container (height < 540px)` (ride.css:706), which the code comments as
    "a short phone window". The result is a title at 31.9px (h2, the same size as at 390) and prose
    at 18px next to a 544x354 gold-framed photo. At 1280x720 it is the same, with a 530x303 photo.
    The photo becomes the focal point. → Scope ride.css:706 to `and (width < 720px)` so wide windows
    use the `height < 600px` step (h1 title, body-md prose). Then re-check that "Our life together"
    (403px of words today) fits the ~481px platform. If it doesn't, shorten the full card's
    `--map-h` for windows 820-950px tall, or cap the side-by-side image at about `50cqh`
    (ride.css:679).
S2. **[req 6, pictures] Double exposure mid-transition.** Media opacity is `1 - |d|*1.6`
    (ride.css:610). Between p = i+0.375 and i+0.625, both pictures are drawn at about 20% on top of
    each other. At the 1440 midpoint, the outgoing wedding photo and the next chapter's gold numeral
    ring overlap (`1440x900-2m-midpoint.png`). → Fade media at `1 - |d|*2` like the words, or fade
    the outgoing picture out before the incoming one starts.
S3. **[req 3, phone] Current station name is under the phone action bar at first load.** At 390x844,
    "How we met" sits at y≈768-790 and `.bd-bar` starts at 779 (`390x844-01-first-load.png`). The
    line shows, but its label is cut. → In compact mode, move the current name onto the head row or
    above the line, or reduce the compact `--map-h` (ride.css:849-882) so it clears the bar.
S4. **[keyboard] Focused car card does not recentre.** `mapHold` stops recentring while a station
    link has focus (StoryRide.tsx:308, 561-564). At 390, arrowing to Our life together and pressing
    Enter leaves the current station at the right edge with its name clipped ("Our life togethe";
    `390x844-41-keyboard-map-focus.png`). → In `onMapFocus`, call
    `link.scrollIntoView({inline:'center', block:'nearest'})`.
S5. **[820x1180] Scrolled full card cuts names mid-word at the left edge** ("um of Ice Cream",
    `820x1180-12-docked-starved-rock.png`). → Add an edge fade on `.bd-ride-map__viewport`
    (ride.css:272-277), a `mask-image` gradient over 24-32px at each end, using the same token
    pattern as ride.css:739.
S6. **[flat mode, phone] The list/reduced-motion car card is truncated with no cue that it
    scrolls.** At 390, the angled card is cut at "Museum of / Ri"
    (`390x844-61-reduced-motion-top.png`), because the compact rules (ride.css:849) apply only to
    `data-mode="ride"`. → Apply the compact strip below 768px in flat mode too, or at least the S5
    edge fade.

## Consider

- The comments at StoryRide.tsx:29-30 and :489-490 say find-in-page still reaches off-platform
  moments. Stops that aren't near are `visibility: hidden` (ride.css:570), so
  `window.find('Mutual support')` from stop 2 returns false. Correct the comment, or say that
  "Read it as a list" is the find-in-page path.
- There are two stacked JSDoc blocks above `fly`, and the first is stale (StoryRide.tsx:186-195).
- "Next stop" / "Arriving at" and "Stop N of 16" use 13px `label-caps` (ride.css:108-116,
  785-792). DESIGN.md reserves that tier for eyebrows above a heading. Both are duplicated
  elsewhere (the live region, and `aria-hidden`), but `control-caps` for the kicker would honour the
  17px floor.
- Text-only chapters in the stacked layout (820x1180) float in about 230px of empty ivory above
  and below, because the numeral is hidden when stacked (ride.css:193-195). Show the numeral under
  the words on tall tablets.
- `onTouchEnd={() => setTimeout(releaseMap, 1500)}` is never cleared (StoryRide.tsx:623).

## What is working (keep)

- The car card itself: McClendon-style names in the line colour, bold transfer names, pill transfer
  rings, the square Loop, and the pointer train. It is the page's own idea and it reads as CTA
  signage without becoming a theme-park backdrop.
- Motion engine: native scroll, one rAF writer, `--d` only on the 2-3 moving layers, plateaus at
  stations, settling only after the pointer lifts, and express jumps that show only the two end
  moments. Measured at a steady 16.7ms per frame.
- Words-first grid, gold-hairline photo frames, the Deco numeral for chapters without a photo, and
  honest "Stand-in photo" plates with licence credits.
- The bar: "Next stop" / "Arriving at" in the next line's colour, Back and Next with 48px targets,
  and arrows with sr-only labels on phones.
- A11y: one tab stop with arrow/Home/End on the car card, `aria-current="location"`, a polite live
  announcement only after settling, off-platform moments `aria-hidden` and out of the tab order,
  and deep links that land on the right station. Axe (WCAG 2.2 AA + best-practice) is clean on load,
  docked mid-ride, in list mode and with reduced motion, at 390 and 1440.
- Reduced motion, no-JS and print get the flat list with the vertical coloured line. The list
  choice persists.
- Source drift 0; design:lint 0 errors; stylelint clean; unit tests 7/7.

## Evidence

- Screenshots (57): `.impeccable/review/2026-09-23-our-story-ride/`:
  `{size}-01-first-load`, `-02-pinned-first`, `-1{0..3}-docked-{slug}`, `-2{a,b,c}-mid-transition`
  (pointer held), `1440x900-2m-midpoint`, `-40-after-express`, `-41-keyboard-map-focus`,
  `-5{0..3}-list-mode-*`, `-6{0,1}-reduced-motion-*`.
- Detector: `check-design-drift` on the 3 files found 0. Rendered scan: 390/820/1440 clean;
  1280x720 has 8 `text-occlusion` (Blocker 1).
- design:lint: 0 errors, 0 warnings. stylelint ride.css: clean.
- axe (`npm run test:a11y --grep our-story`, mobile/tablet/desktop): 3 passed, 0 serious/critical.
  Additional axe runs mid-ride, in list mode and with reduced motion: clean.
- Frames (rAF deltas): Next stop p95 16.8ms, max 16.8. 13-stop express jump p95 16.8ms, one
  33.4ms frame at 390. Wheel scrub p95 16.8ms. No long animation frames.
- Fit: at all four sizes, all 16 stops dock without `data-tight` or `data-overflow`
  (platform scrollHeight equals clientHeight).
- Web-quality/Lighthouse: not run, because this is a dev server, not a deployed URL.

Next command: `/impeccable polish src/themes/botanical-deco/kit/StoryRide.tsx`, covering Blockers 1-2,
then S1-S2, then re-run `npm run slop:detect:rendered -- /our-story`.

## Resolution (same day, on PR #41)

- **Blocker 1 (text-occlusion at 1280x720):** fixed at the source. The compact strip's hidden names
  are `display: none`, and each station link carries its own name (`aria-label`). Rendered scan of
  `/our-story` at 390x844, 820x1180, 1280x720, 1280x800 and 1440x900: clean. No waiver added.
- **Blocker 2 (mode switch loses the place):** the switch remembers the stop. Ride → list scrolls
  to that stop's section and focuses it; list → ride docks at the section being read. Covered by
  the e2e "Read it as a list" test.
- **Should-fix 1:** the short-phone type rule is limited to narrow windows (`width < 720px`). A
  separate step down (still 17px) applies to wide windows under 480px, so every stop fits at
  1280x720, 1366x768 and 1440x900.
- **Should-fix 2:** pictures fade at `1 - |d| * 2`, the same as words. No picture overlaps another.
- **Should-fix 4:** a keyboard-focused station scrolls to the middle of the strip. A tapped one
  doesn't, because moving the strip under a finger would lose the tap.
- **Should-fix 5/6:** the ends of the strip fade in every mode.
- **Also fixed:**
  - "Next stop" and "Stop N of 16" are 17px.
  - The find-in-page comments are corrected.
  - The stale comment is removed, and the strip's touch timer is cleared.
- **Found while fixing:** a deep link could land one stop late. The site's `scroll-behavior:
  smooth` animates the browser's own fragment scroll, and that animation can finish after the ride
  has jumped. For 1.5s after landing, unless the guest scrolls or chooses another stop, a scroll
  that ends elsewhere is put back on the linked station. Result: 20/20 deep links on phone and tablet.
- **Not changed:**
  - Should-fix 3. On a phone's first load, the site's own bottom action bar covers the current
    station's name; the line itself is visible.
  - Text-only chapters on tablet keep their generous space.
