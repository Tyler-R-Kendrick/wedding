# Our Story as a ride — timeline brief and references

| Field | Value |
|---|---|
| Date | 2026-09-22 |
| Surface | `/our-story` (Botanical–Deco recipe `src/themes/botanical-deco/recipes/story.tsx`) |
| Asked for by | Tyler: "a timeline… it needs to feel like we're travelling through the memories, not moving up/down a page… the control should feel like a CTA train line diagram, not a typical timeline chart." |
| Content | The couple's Paired timeline, not yet uploaded. Until it is, every station is a labelled `TODO(Tyler & Sara)` placeholder with an openly licensed photograph of a place the brief already names. |

## 1. What we looked at

Award-level work whose *mechanism* answers the brief. We borrow mechanisms, never a look.

| Reference | Recognition | Mechanism we borrow | What we leave |
|---|---|---|---|
| **Oryzo** (oryzo.ai) | Awwwards Site of the Month, April 2026 + Developer Award | Scroll moves the *camera* through true Z depth instead of sliding 2D layers past it. This is the core of "travelling through" rather than "moving down". | WebGL and a 3D pipeline. We do the same with CSS `perspective` + `translateZ` and one custom property, because packages are fixed and hotel Wi-Fi is a constraint. |
| **Explore Primland** (explore.ownprimland.com) | Awwwards Site of the Day, February 2026 | A scroll-driven fly-through that *pauses* at points of interest with atmospheric fog between them. | Terrain and fog shaders. We keep the pacing: travel, arrive, dwell, depart. |
| **Cartier — Watches & Wonders** | Awwwards SOTD + CSS Design Awards | "You scroll between rooms, not down a page": each stop is a place you arrive in. | Luxury restraint that hides the way out; our exit (Places, Adventures) stays one scroll away. |
| **Michael R. Johnson portfolio** — "Gallery Z-Axis Depth Scroll" | Awwwards Inspiration element | Photographs placed at increasing depth; the nearest one resolves, the far ones wait in the haze. | A gallery with no story; ours has a line and an order. |
| **Base Planning** — "Scrolling Timeline" (Dirty Martini) | Awwwards Inspiration element | A pinned timeline control whose progress indicator is continuous with scroll, not stepped. | Lenis/GSAP. Native scroll only — no scroll-jacking, so assistive tech, find-in-page and the scrollbar keep working. |
| **The Memories We Shared** (monopo) | Awwwards Honorable Mention, 2020 | Memories as a fullscreen, one-at-a-time sequence you move *through*. | Horizontal infinite scroll. |

## 2. The control: a CTA car card, not a chart

Inside every CTA 'L' car, above the doors, is a strip map of the line you are
riding. That is the control. The conventions come from Dennis McClendon's 1993
redesign of the CTA map (transitmap.net, "Evolution of the Chicago CTA Rail Map
1996–2006"):

- **Fat colour lines**, one colour per line. Here a *line* is a chapter of the
  story (met → connection → life together → love → future → engagement →
  marriage); the train changes line where the story changes chapter.
- **White station circles** with a dark ring for ordinary stops.
- **Hollow dumbbells** for transfers: a stop that ends one chapter and starts
  the next is drawn as two joined rings, "instantly comprehensible".
- **Station names in the colour of their line** (McClendon's hierarchy rule),
  angled on the strip like the car cards so every name fits at 17px.
- **A terminal** at the end of the line: 07 · 17 · 27, the Chicago Athletic
  Association, in the Loop.
- The **train** is a marker on the line that moves continuously with scroll, and
  the **next-stop sign** reads like the car's announcement: "This is Starved
  Rock. Transfer to the Pink Line."

It is not Helvetica. The approved design has no sans (DESIGN.md → Typography),
so names are Newsreader capitals and the terminal is Bodoni; the CTA-ness is in
the geometry and the colour, which is where it lives on the real map anyway.

## 3. The ride

1. **Board.** The approved panoramic hero stays. Under it, "All aboard" says
   what to do in one line: scroll to ride; tap a station to jump.
2. **Travel.** A pinned stage holds every station at its own depth down a
   track. Scrolling moves the camera forward: the next memory grows out of the
   haze, the one you just visited slides past the edge of the window. Rails and
   sleepers on the floor plane run under you, so motion is felt even between
   stops.
3. **Arrive and dwell.** Scroll is mapped with plateaus: a short stretch of
   travel, then a longer stretch where the train is *stopped* at the station and
   the memory is still and readable. Nobody has to read text that is moving.
4. **Transfer.** Where a chapter ends, the stop is a transfer: the chapter's
   own words (the `story_sections` prose) and the new line's colour.
5. **Terminal.** The last stop is the wedding. Then the doors open onto the
   approved "Places that shaped us" band.

## 4. Guardrails (all non-negotiable)

- **Native scroll.** No wheel hijacking, no smooth-scroll library. The page is
  as tall as the ride; one rAF-throttled listener writes one custom property.
- **Reduced motion** (`prefers-reduced-motion: reduce`), **no script**, and
  **print** all get the same ride laid flat: a vertical strip map with each
  station as a readable section beside the line. Same DOM, same order.
- **Keyboard:** every station on the car card is a link to `#slug`; arrow keys
  move between them; focus inside the stage brings its station to the front.
- **Screen readers** read the stations as an ordered list in story order; the
  depth is presentation only. The next-stop sign is a polite live region that
  speaks only on arrival.
- **17px floor, AA contrast:** every line colour is a DESIGN.md token that
  passes 4.5:1 on Ivory, because station names are set in it.
- **Truth:** no invented dates, places or captions. A station with no date
  says "Date from Paired", not a plausible year.

## 5. Revision, 2026-09-23 — the ride matches the design

Tyler and Sara's review of the first build: it did not feel smooth or like the
rest of the site, the "train backdrop" competed with the memories, and the
cards led with photographs. What changed, and what it replaces above:

- **No depth, no backdrop.** The stage is the page's own Ivory. The Z-depth
  fly-through (§1 Oryzo, the z-axis gallery) and the floor and skyline (§3.2)
  are gone: a moment at its station is the only thing on the stage. Travel is a
  horizontal drift — the moment you leave slides left and fades before the next
  slides in from the right, its picture moving a little further than its words.
- **The car card is horizontal everywhere** (§2), as it is above a car's doors:
  a fat line in each chapter's colour, names angled above it on tall screens, a
  compact strip with the current name on phones and short windows. Line names
  ("Red Line") are never printed: the colour is the way-finding.
- **Words first.** Each moment is a meta line (chapter, or date · place), its
  title in italic Bodoni, then its words; the photograph follows in a gold
  hairline frame. Sara's ask: the memory is what catches the eye.
- **It fits.** The line starts directly under the opening, so the first screen
  shows it; the pinned stage fits one viewport, stepping the type down the ramp
  and then letting a picture go before any words have to scroll.
- **Settling, not snapping.** CSS scroll snap caught almost every position on a
  ride this long and pulled each mouse-wheel notch back. When scrolling stops
  between two stations, the train now rolls on to the nearer platform — never
  while a finger or button is down. The guardrails in §4 still hold; "one custom
  property" is now two: `--p` on the train and `--d` on the moments beside it.

