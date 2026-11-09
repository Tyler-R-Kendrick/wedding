# Design review — `/` (signed out), `/guests`, `/guests/travel` (signed-in guest) — 2026-11-09

Theme: botanical-deco. Server: http://localhost:3100 (NODE_ENV=test), lifecycle state rendered: **TEASER**.
Widths: 390x844, 820x1180, 1440x900 (plus 390x664 and 1280x800 spot checks). Read-only review; no source edited.

## Verdict: FIX FIRST

Scores (1–10) — ship threshold: all >= 7 and Usability >= 8 (wedding-site-standards §5)

| Surface | Design | Usability | Creativity | Content | Result |
|---|---|---|---|---|---|
| `/` signed out | 8 | 7 | 8 | 7 | FIX FIRST (2 blockers) |
| `/guests` dashboard | 7 | 7 | 6 | 7 | FIX FIRST (Usability < 8, Creativity < 7) |
| `/guests/travel` | 7 | 7 | 7 | 7 | FIX FIRST (Usability < 8) |
| Overall | 7 | 7 | 7 | 7 | FIX FIRST |

None of the three needs a redesign. The structure of each is right; the misses are specific and small.

## Blockers (must fix)

- **B1 [privacy, measured] The city is named to a signed-out visitor.** The Home hero `<img>` alt reads "Generated portrait of Sara and Tyler cheek to cheek on a bridge over the **Chicago River**, the towers of downtown glowing behind them." It is in the served HTML twice (markup + RSC payload), read aloud by screen readers and shown if the image fails. Source: `scripts/botanical-deco-media.mjs:52` and `:54` (slots `couple.hero.formal`, `.mobile`), emitted into `public/media/botanical-deco/manifest.json`. PRODUCT.md: "Nothing about the wedding is public… the date, the venue, the city". → Rewrite both alts without a place ("…cheek to cheek on a bridge at dusk, city lights behind them."), regenerate the manifest, and add the hero alt to whatever test asserts the signed-out page carries no city.
- **B2 [owner requirement, measured] The hero button does not name the one thing to do in the state being served.** State is TEASER. Home hero and closing buttons read "GUEST SIGN-IN" → `/sign-in?next=%2Fguests`; the dashboard in the same state says "Please save the date. First, reserve your room…" and leads with "Reserve your room". `src/domain/lifecycle/guest-actions.ts:43` (`ACTION_BY_STATE.TEASER = 'Guest sign-in'`) disagrees with `:69` (`TASKS_BY_STATE.TEASER = ['stay','flights','around']`), although the file's own header says both read one table. → Either set TEASER to `{ label: 'Book your hotel room', href: GUEST_PATHS.travel }` and match `home-content.ts:81` (eyebrow/lede), or, if TEASER really precedes the block opening, change `TASKS_BY_STATE.TEASER` and `Dashboard.tsx:52-54` so the dashboard does not say "save the date / reserve your room" yet. Derive the hero action from the plan's lead so they cannot drift. (SAVE_THE_DATE is already correct.)

## Should fix (the first six are what lifts Usability to 8)

1. **[hierarchy, phone] Travel buries the booking button.** At 390, arriving at `/guests/travel#stay` puts the "Book in our room block" button at y=937 in an 844px viewport (779 usable above the tab bar); from the top of the page it is ~1,500px down. Hotel intro, address, upgrades paragraph and hotel-website link all come first. This is also where Home's "Book your hotel room" lands once B2 is fixed. `src/themes/botanical-deco/recipes/travel.tsx:56-99`. → Below 760px put `.bd-travel__block` directly under the hotel name: move the `<h3>` above the grid (or `display: contents` on `.bd-travel__hotel` + `order`), so rate, book-by and the button are the first thing under "Where to stay".
2. **[hierarchy, phone] Dashboard first screen: the deadline is below the action.** At 390x844 the first screen holds greeting, status line, When/Countdown/Where (153px), then the lead's kicker, title, paragraph and button (y=639–725). "Book by Tuesday, June 15, 2027" — the only time-critical fact — is at y=978, after the phone line and a secondary link. `Dashboard.tsx:298-317` renders `facts` after `main`. → Make the deadline the kicker, as `rsvpCard` already does ("Kindly reply by…"): `Dashboard.tsx:110` kicker `Book by ${formatLongDate(block.cutoff)}`; and on <760px render `.dash-lead__facts` between the body and `.dash-lead__actions`.
3. **[hierarchy, short phone] At 390x664 the lead button (y=639–725) is under the tab bar (starts y=599).** The greeting block costs 289px. `dashboard.css:46-58`, `Dashboard.tsx:353`. → Drop the status line when a lead card exists (it restates the lead: "First, reserve your room while our block has space" vs "Reserve your room… Rooms in the block are limited"), and set When + Where as one line under the greeting on phones. Saves ~110px and one of the redundancies below.
4. **[gate 49, measured] Primary button label wraps to two lines.** Dashboard at 390: 324x86px, "BOOK IN OUR ROOM / BLOCK". Travel at 390, 820 and 1440: 67px tall on two lines ("BOOK IN OUR / ROOM BLOCK →"), 250px wide inside a 298px column at 820 and 1440. `Dashboard.tsx:128`, `travel.tsx:87`. → One label everywhere: "Book your room" (the home hero in SAVE_THE_DATE says "Book your hotel room", the dashboard title says "Reserve your room": pick one verb).
5. **[usability] Phone number is not tappable.** No `tel:` link on either page (0 found). `Dashboard.tsx:134`, `travel.tsx:92`. For grandparents the call is the real path. → `<a href="tel:+18443122221">844-312-2221</a>`, 44px target.
6. **[standards §8] The venue address on Travel is plain muted text** ("12 S. Michigan Avenue, Chicago, IL 60603", `travel.tsx:61`) while the footer has the same address as a Maps link, formatted differently ("12 S Michigan Ave"). → Link it with `frame.details.venue.mapsUrl` and use one formatting.
7. **[consistency] The same booking link behaves two ways.** Dashboard: `target="_blank"`, sr-only "(opens in a new tab)", no visible mark. Travel: same tab, no `target`, and the internal arrow glyph, to hyatt.com. PRODUCT.md voice: "Every external handoff is explicit". `Dashboard.tsx:96-103`, `travel.tsx:86` (`Button variant="primary"`). → One treatment: external mark + provider named, same tab behaviour on both.
8. **[layout, 1440] Travel uses the width, but unevenly.** The frame is 1200px: a 260px rail holding only an `<h2>` (static, so 500–660px of empty rail beside each section) and a 779px body in which the terms block is squeezed to 298px — the button wraps and the phone line runs 4 lines at ~22 characters. Airports column is also 298px. `kit.css:3769-3790`, `:3919-3927`. → Rail `2fr/10fr` (or make `.bd-head` `position: sticky`), `.bd-travel__stay` `6fr/6fr` with the block `min-width: 22rem`. Not the old half-blank page, but the squeeze is the visible flaw now.
9. **[layout, 1440] Dashboard greeting leaves the right half empty.** `.dash-head` is 1156px wide; the status line stops at 561px and the facts row ends near x=885, so the first ~240px of the page is blank from x≈700 to 1298, above a lead card that does use both columns. `dashboard.css:26-29, 77-96`. → From 1040px lay `.dash-head` on the lead's own `3fr/2fr` grid: greeting left, When/Where/Countdown stacked right, aligned to the facts column at x=853. This is the one leftover half-empty area at 1440.
10. **[type floor] Dashboard fact labels are 13.8px.** `dt` "When / Where / Countdown / Group rate / Book by / Nights" use `label-caps` (`dashboard.css:60-69`); Travel sets the same three labels at 18px (`.bd-stat__label`). DESIGN.md: "Only eyebrow labels above a heading use `label-caps` (13px)". → `control-caps` for `.dash-head__facts dt` and `.dash-facts dt`; keep `.dash-kicker` as is.
11. **[content] "NIGHTS — Nights of Friday, July 16 and Saturday, July 17, 2027"** on both pages: the label repeats inside the value, and the weekdays are typed. `src/domain/travel/stay-copy.ts:25`. DESIGN.md: "Do derive weekdays from dates; don't type 'Wednesday, July 16'". → Derive from `checkIn`/`checkOut`; value "Friday, July 16 and Saturday, July 17, 2027".
12. **[content] Stale hint inside "Compare rates at other hotels nearby":** "The wedding block above has its own link once the planner confirms it." The link is confirmed and shown above. `src/app/(guest)/guests/travel/search-form.tsx:278`. → Cut the second sentence.
13. **[content] "Room details and other hotels"** (`Dashboard.tsx:136-138`) leads to a section with no other hotels (`alternatives` is empty; only a collapsed rate search) and room details that are the same three facts. → "Room details" until alternatives exist.
14. **[standards §8] Group code not shown.** `CAA_GROUP_CODE` exists (`stay-copy.ts:15`) and the checklist asks for "Hotel block: code + cutoff date"; neither page prints it. → Add to the phone line: "…and mention '…Room Block' (group code G-FIKE)".
15. **[form] Flight search row misaligned and clipped.** The "Flying from" hint sits between label and input, so its input is ~48px lower than the "Flying to" select beside it; the select is 200px wide and clips to "Chicago O'Hare (C" at 820 and 1440. `search-form.tsx:193, 221` and `Field` (`:34-58`). → Hint under the input (or `align-items: end` on the row); options "O'Hare (ORD)" / "Midway (MDW)".
16. **[privacy, adjacent] Pictures and a public file still say where.** (a) The hero photograph is a recognisable downtown riverfront and the footer line-drawn skyline (`kit/index.tsx:236`) renders signed out; text is clean, but the image is the city. Owner decision: accept, or use a non-skyline crop and hide `.bd-footer__skyline` without `details`. (b) `/media/botanical-deco/manifest.json` is served signed out (200, 55 KB) and names "Chicago Athletic Association" 19 times in photo credits. Not on the page, but one URL away. → Keep venue entries out of the public manifest or serve it behind the guest gate.

## Repetition across the three pages (called out as requested)

- **Room block, word for word, twice:** group rate, book-by, nights, the button and the phone sentence are identical on the dashboard lead and in Travel's aside. Acceptable only if the dashboard is the short form: keep rate + book-by + button on the dashboard, leave nights and the phone line to Travel (or the reverse), not both in full.
- **"Fly into O'Hare" — three statements on two pages:** dashboard flights card (`Dashboard.tsx:222`), Travel eyebrow "ORD · Recommended", and the sentence under it "We recommend flying into O'Hare." (`src/domain/travel/facts.ts:45`) — the last two are in the same card.
- **Blue Line from O'Hare — three statements:** dashboard "Getting around" card (`Dashboard.tsx:234`), Travel › Flights airport note (`facts.ts:45`), Travel › Getting around (`travel.tsx:186`). The recipe's own header says each fact is said once.
- **Taxis and rideshare — three statements:** dashboard card (`:234`), Midway note (`facts.ts:51`), Travel › Getting around (`travel.tsx:192`).
- **"Rooms are limited" — three statements:** dashboard status line, dashboard lead body, Travel intro (`stay-copy.ts:6`). Mild, but PRODUCT.md lists scarcity pressure as an anti-reference; say it once.
- **Hotel name:** three times on the dashboard (Where fact, lead body, footer); the date three times (When, Nights, footer).
- **Home:** the sign-in sentence appears verbatim twice ("sign in with the email or mobile number we have for you": hero note `home-content.ts:124`, closing `:42`), the hero lede says it a third way, and there are five sign-in links (nav, 2 buttons, footer, menu). The triad is stated three times (h2, the three words, footer motto) — the last is by design.
- → Fix: dashboard cards carry the action only ("Search from your home airport." / "Trains, rides and parking, on one page."); airport notes in `facts.ts` keep the recommendation, `travel.tsx` "Getting around" keeps the transit facts; drop the hero note or the closing sentence on Home.

## Consider (nits)

- `guest.css:221-223` — `.dash-card:hover` turns the border gold but the card is not clickable (cursor auto). Stretch the card's link over it or drop the hover.
- `nav-utils.ts:15` — tab-bar label "Things" for Things to Do reads as a fragment; "To do" or "Explore".
- `home.tsx:86` — "How it all started" is roman, its sibling "The places we have been" is italic; DESIGN.md names "How It All Started" as the italic card-title example. Add `bd-italic`.
- `kit.css:875-881` / `:966-972` — at 1440 the hero note starts at x=92 under a bloom that reaches x=101 (leaf tips touch "Invited") and runs to x=551, 61px into the photo's fade. Cap the note at ~24rem or lift the bloom.
- `dashboard.css:55-58` — on phones the facts are visually When, Countdown, Where but DOM order is When, Where, Countdown.
- Dashboard at 1440: content column starts at x=142 while masthead and footer start at x=48.
- Print: the dashboard prints without the booking URL (button hidden); add it to the print list as the footer does for directions.
- Straight apostrophes in `facts.ts` airport name ("O'Hare International Airport") and `stay-copy.ts:6,9` ("We've", "we'll") beside curly ones elsewhere.
- Home "Happiness" line ends "Then dinner, toasts and dancing." (`home.tsx:31`) — the shape of the evening, arguably schedule. Owner call.
- Dashboard Creativity (6): the "now / then / more to read" ordering is the right idea, but nothing on the page is from the system's own vocabulary. DESIGN.md's Date tile (month, Bodoni day, derived weekday) for "When", with the day count, would give the header an identity and fix item 9 in one move. No photo hero needed.

## What is working (keep)

- No date, venue, city, schedule or countdown in any visible text on signed-out Home, in meta tags, title or headers; `/guests` and `/guests/travel` 307 to `/sign-in?next=…`; footer drops date/city/address without `details`.
- Dashboard: no photo hero, no tabs, nothing a guest cannot use yet (no seating, photos, video, gifts, RSVP in this state); lead → Then → More to read is clear; "More to read" as a ruled list rather than more cards.
- Travel: one page in booking order; real two-column compositions at 820 and 1440; no horizontal overflow at any width.
- Accessibility: axe-core 0 violations on all 9 page/width combinations; every input labelled; focus rings visible (3px/2px solid) in a sensible tab order; standalone links and buttons >= 44px; body text >= 17px (root 17px).
- Tokens: no raw hex or `font-family` literals in the target files; only Bodoni Moda + Newsreader render; reveal motion is gated on `prefers-reduced-motion`, no bounce.
- Generated portraits are labelled "Generated portrait" in alt text, credited at `/credits` and recorded as authorised stand-ins (`docs/ops/asset-licensing.md`); not raised as a finding.

## Evidence

- Screenshots (fold + full page, 3 surfaces x 3 widths), crops, print views and metrics: `/tmp/claude-0/-home-user-wedding/3cc5b0ee-ccfe-5c59-bf17-b84f2e1c1ca6/scratchpad/review/`
- Detector: `slop:detect:rendered` on `/`, `/guests`, `/guests/travel` at 390/820/1440 — clean (0 findings). `check-design-drift.mjs` on the 7 target files — 0 anti-patterns, all values on scale.
- `design:lint`: 0 errors, 0 warnings (all four DESIGN.md files). stylelint on the three CSS files: clean.
- axe (wcag2a/aa, 21aa, 22aa, best-practice) via Playwright: 0 violations, 9/9.
- hallmark audit: 0 critical · 1 major (gate 49, two-line button) · 3 minor (static title rail / narrow measures; `.dash-card` hover without action; italic/roman sibling headings). design-anti-slop Mode B: no V or S hits; layer-3 note only (repetition; greeting-card register in the Home lede, which is the couple's to edit).
- Not run: Lighthouse / Core Web Vitals (dev server, numbers would not be meaningful); `npm run test:a11y` as a suite (axe was run directly instead); `/impeccable critique` and `audit` as skill flows and the motion skill's HTML report (covered by inspection, kept proportionate); `npm run quality` in full.

## Next command

`/impeccable polish /guests/travel` after B1 and B2 land (items 1, 4, 5, 6, 8 are one pass through `travel.tsx` and the travel block in `kit.css`), then `/impeccable polish /guests` for items 2, 3, 9, 10.
