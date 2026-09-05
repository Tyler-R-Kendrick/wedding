# Sara + Tyler — design document (living)

> What we are designing, for whom, and how it must behave. Facts come from
> [`brief.md`](brief.md) only. Tokens live in `src/themes/<id>/DESIGN.md`;
> this document explains the design, it does not restate the tokens.
> Process: [`../sdlc/PROCESS.md`](../sdlc/PROCESS.md). Decisions:
> [`../adr/README.md`](../adr/README.md). Changes: [`CHANGELOG.md`](CHANGELOG.md).

## 1. Goals and north star

**Thesis** (brief §1): Sara and Tyler are inviting the people they love into
the places, experiences, adventures, and memories that shaped their life
together, and helping those guests make memories of their own.

**North star** (Sara's priorities): *"Happy, relaxed people"* and
*"Dancing."* Remove uncertainty, explain things clearly, then get out of
the way.

| Goal | Measure |
|---|---|
| Logistics findable instantly | Names, date, place, and the state's primary action visible without scrolling at 390px; any logistic ≤ 2 taps from Home |
| RSVP is calm | Household RSVP completable in < 2 minutes on a phone by a grandparent; zero pressure timers |
| Story before utility, utility when it matters | Home reconfigures by lifecycle state (§3); story pages are explorable in `TEASER`, operational pages lead in `WEDDING_WEEK` |
| Personal, not creepy | Personalisation only from invitation data and opt-in preferences; no IP geolocation; explicit external handoffs |
| Two designs, one truth | Every surface ships in Gilded Hour and Conservatory from one content layer (ADR-0009) |
| Award-level craft | Every surface ≥ 7/8/7/7 on Design/Usability/Creativity/Content before ship (`wedding-site-standards` §5) |

## 2. Audiences

From brief §2 "Guest profile". Universe ≈ 105 adults + 28 children + 9
plus-ones = 142; planner agreement anticipates 110–160.

| Audience | What they need | Design consequence |
|---|---|---|
| Travelling guests (many; incl. California/Nevada) | Flights, where to stay, how far, what it costs, what else to do | Travel & Stay and Transportation are first-class, not FAQ entries; time zone on every time |
| Families with children (28 children) | Kid policy, what's near, stroller/quiet options, itineraries "with kids" | `TODO(Tyler & Sara)` kid policies surface early; itinerary filter "with kids" |
| Older relatives | Large legible text, print, phone calls over forms, valet and elevators | 17px body minimum, visible labels, printable logistics, phone-number fallbacks, accessibility info from CAA `/about/faq/` as a dated record |
| Cost-sensitive travellers | Room-block rate and cutoff, alternatives, ride costs, free things to do | Prices shown only from verified records with `verifiedAt`; never guessed |
| First-time Chicago visitors | Orientation, the building, the neighbourhood, "look for this" | Explore CAA docent; Share an Adventure itineraries by duration |
| Weekend extenders | Friday afternoon / Saturday morning / Sunday ideas | Itinerary buckets (brief §6) |
| The couple and wedding party | Preview, check the run of day, share the link | Admin preview (ADR-0012); Your Weekend for party members |
| Guests' own agents | Read schedule, draft RSVP | WebMCP over the same capabilities (ADR-0002) |

## 3. IA and navigation by lifecycle state

Twelve public surfaces (brief §5), one gate flow, one admin. Navigation
shows at most five items on mobile; the rest live in "More". Order and
membership change per state (ADR-0012).

| State | Primary nav (mobile, ≤ 5) | Home's job | Sticky bar |
|---|---|---|---|
| TEASER | Story · Adventures · Explore CAA | Names, `07 · 17 · 27`, one line of thesis | none |
| SAVE_THE_DATE | Story · Travel & Stay · The Wedding · Adventures | Date (weekday), city, "details to come", travel heads-up | none |
| INVITATIONS_OPEN | The Wedding · Your Weekend · Travel & Stay · Story | Claim your invitation | Claim |
| RSVP_OPEN | RSVP · The Wedding · Travel & Stay · Transportation · Your Weekend | RSVP CTA + deadline (`TODO(Tyler & Sara)`) | RSVP · Directions |
| RSVP_CLOSED | The Wedding · Travel & Stay · Transportation · Your Weekend · Adventures | "We can't wait", logistics digest | Directions |
| WEDDING_WEEK | Your Weekend · Transportation · The Wedding · Ask Us · Share an Adventure | Your itinerary, rides, what's open | Directions · Ask Us |
| WEDDING_DAY | Today · Ask Us · Photos & Video · Transportation | Now / next, your table, ride home | Now · Ask Us |
| POST_WEDDING | Photos & Video · Adventures · Story · Share an Adventure | Thank you; add your photos | Add photos |
| ARCHIVE | Photos & Video · Story · Adventures · Explore CAA | The weekend, preserved | none |

Desktop shows the full set in state order. Gifts is always reachable from
"More" and from Home in `RSVP_OPEN`+ (never above the RSVP). Ask Us is a
floating entry from `WEDDING_WEEK` onward and a nav item otherwise.

## 4. Page inventory

Route slugs are proposals for level 03; page names are the guests'
vocabulary and must not change. "Fold" = visible without scrolling on a
390×844 phone with the browser chrome present.

| Page | Route | Job | Above the fold on 390px | States |
|---|---|---|---|---|
| Home | `/` | Answer when/where/what-now for this state; open the story | Names; date with weekday; city + venue name; state's primary action; theme switcher (until chosen) | all |
| Our Story | `/story` | Short, authored arc: met → connection → relationship → love → future → engagement → what marriage means | Eyebrow "Our Story", first chapter title, first paragraph, one image or motif | all |
| Our Adventures | `/adventures` | Expansive, structured `AdventureMemory` records with optional "Sara remembers / Tyler remembers" | Section intro + first memory card with place and year; filter by motif | all |
| Share an Adventure | `/share-an-adventure` | Recommendations linked to memories; itineraries by 45 min / 2–3 h / Friday afternoon / Saturday morning / with kids / architecture / food & drink / stay inside CAA | Itinerary picker (duration/mode chips) + first recommendation with practical layer visible, memory layer collapsed | SAVE_THE_DATE+ |
| The Wedding | `/the-wedding` | Ceremony, cocktail hour, reception: room (`TODO`), times (`TODO`), dress code (`TODO`), what happens, accessibility | Date + weekday; venue + tappable address; first event name/time (or dated "times to be confirmed"); dress code line | INVITATIONS_OPEN+ |
| Explore CAA | `/explore-caa` | Docent: building, spaces, history with provenance, on-property outlets as live links, "look for this" details, floor plans with your table when published | One-line "built 1893…" hook; image frame; "Spaces" and "Look for this" entry points | all |
| Your Weekend | `/your-weekend` (auth) | Personal hub: your invitation, events, RSVP status, table (when published), benefits (block link, voucher), preferences | Greeting by first name; RSVP status or CTA; next event; your benefits list | INVITATIONS_OPEN+ |
| RSVP | `/rsvp` (auth) | Household-aware RSVP: per-event accept/decline, per-person meal (`TODO` menu), dietary notes, plus-one per invitation, message | Household names; first event accept/decline controls; deadline | RSVP_OPEN, edit-by-request after |
| Travel & Stay | `/travel` | Airports (`TODO` which to recommend), CAA block (rate/URL/cutoff `TODO`), alternatives (`TODO`), neighbourhood, weather expectations | Hotel block card with dated status; airport line; "book" action or honest unavailable | SAVE_THE_DATE+ |
| Transportation | `/transportation` | Valet (71 E Madison, special event rate — verify), transit directions (CAA FAQ link), rides + voucher (`TODO`), parking, accessibility | Venue address + map handoff; valet line; ride action | INVITATIONS_OPEN+ |
| Gifts | `/gifts` | "Help us with our next adventures": registry (`TODO` provider), experience gifts, gift cards; presence first | Presence-first sentence; registry handoff button; experience gifts entry | RSVP_OPEN+ |
| Photos & Video | `/photos` | Engagement photos (`TODO`), then guest uploads and professional galleries by rights | Gallery first row or upload CTA (state-dependent); rights note | all (content varies) |
| Ask Us | `/ask` | Grounded concierge with citations; "I don't have that information" as a good answer | Input with example questions; last answer; contact fallback | all; floating from WEDDING_WEEK |
| Invitation discovery | `/i/[token]` | Show the household preview and offer the claim; never a session | Household names as printed; events; "Claim with your email" | INVITATIONS_OPEN+ |
| Claim (OTP) | `/claim` | Email → code → binding; offer passkey after | Email field with visible label and the reason we ask | INVITATIONS_OPEN+ |
| Admin | `/admin/*` | Lifecycle override/preview, content + provenance, moderation, tables | not designed in this document | all |

Every logistics page (The Wedding, Travel & Stay, Transportation, Your
Weekend) prints legibly in black and white with full URLs for map links.

## 5. The two themes

Both interpret the building — Venetian Gothic, Carrara marble, stained
glass, walnut, brass — without cloning the brochure (brief §4). Shared
palette family: white/ivory, gold, light blue, creme/light brown,
foliage/moss. Five motifs run through both: **Adventure, Place, Memory,
Hospitality, Future.** Anti-references apply to both (brief §4).

| | Gilded Hour | Conservatory |
|---|---|---|
| Tokens | `src/themes/gilded-hour/DESIGN.md` | `src/themes/conservatory/DESIGN.md` |
| Inspo board | [`inspo/gilded-hour.md`](inspo/gilded-hour.md) | [`inspo/conservatory.md`](inspo/conservatory.md) |
| Direction | Art Deco. White marble ground, gold leaf, sunburst and chevron geometry, stepped frames, numbered sections, symmetrical monumental layouts | Botanical. Foliage, moss, pressed-flower cards, light-blue sky washes over creme, botanical line-art borders, organic asymmetry |
| Type | Cinzel (display) · Josefin Sans (text/labels) · Big Shoulders Display (numerals; Chicago's municipal typeface) | Gloock (display) · Spectral (text) · Cardo italic (accents). No script faces |
| Motif carriers | Numerals (`07 · 17 · 27`), engraved rules, stepped frames, sunburst dividers | Pressed-flower cards, leaf borders, sky washes, moss textures |
| Motion | Curtains, elevator doors, engraved reveals — moving through a building | Leaves settling, soft parallax — turning archive pages |
| Structure | Centred axis; numbered sections; symmetric pairs; hero as monument; grid never breaks | Off-axis; cards pinned like specimens; images break the grid by one column; captions hang in gutters |
| Ground | Marble white / ivory with gold hairlines | Creme with sky-blue washes and moss accents |
| Where it shines | The Wedding, Explore CAA, Countdown, Timeline | Our Adventures, Share an Adventure, Photos, Story |
| Risk to watch | Reads cold or "hotel brand"; gold on white contrast | Reads "template floral"; watercolor drift; illegible on busy backgrounds |

Same everywhere: kit contracts (§6), a11y (§8), print styles, copy,
lifecycle behaviour, and the reduced-motion fallback (§7).

## 6. Shared component kit

Contract in `src/components/<Name>/` (props, slots, states, a11y);
expression in `src/themes/<id>/kit/<Name>`. Page recipes in
`src/themes/<id>/recipes/`. A component never reads a fact; it renders
what a capability returns.

| Component | Contract (theme-agnostic) | Gilded Hour | Conservatory |
|---|---|---|---|
| Shell | Theme attribute, lifecycle state, skip link, landmark regions, sticky bar slot, switcher slot | Marble ground, gold top rule | Creme ground, sky wash at top |
| Nav | ≤ 5 items mobile, "More" sheet, current page marked, 44px targets, `aria-current` | Small-caps Josefin, centred, gold dot marker | Spectral, left-aligned, leaf marker |
| Footer | Contact route, theme switcher (after choice), rights note, print URL list | Engraved rule + numerals | Botanical border |
| Hero | Names, date, place, primary action, optional media; state-aware | Monumental centred, stepped frame | Off-axis, image bleeds, pressed caption |
| Section | Spacing rhythm, optional inverse/alt ground, `id` for deep links | Numbered (`01`) with sunburst rule | Unnumbered, leaf rule, asymmetric padding |
| SectionHeading | Eyebrow + title + optional lede; heading level prop | Cinzel, tracked caps eyebrow | Gloock, Cardo italic eyebrow |
| Eyebrow | Label above headings; never the only heading | Gold small caps | Moss italic |
| Prose | 55–72ch measure, 17px+ body, links underlined, `TODO` placeholders styled as placeholders | Josefin body | Spectral body |
| Card | Container with heading, body, optional media/actions; no nested cards | Stepped frame, hairline gold | Pressed-flower card, torn-paper edge |
| ImageFrame | `srcset`, AVIF/WebP, explicit dimensions, caption, credit/attribution slot, `alt` required | Gold chevron corners | Botanical line-art border |
| Gallery | Keyboard-navigable grid, lightbox `Dialog`, rights-aware download, lazy below fold | Symmetric grid | Masonry-ish, offset rows |
| Button | primary / secondary / ghost / external; 44px min; loading + disabled states; external variant shows provider name | Engraved gold on marble | Moss on creme, soft edge |
| Link | Underlined, visible focus, external marked | Gold underline | Moss underline |
| Divider | Hairline, optional ornament | Sunburst | Leaf sprig |
| Countdown | Tabular numerals, "days" label, no digit bounce, hides at WEDDING_DAY | Big Shoulders numerals | Gloock numerals |
| Timeline | Events with time (weekday, TZ), place (map handoff), "now" marker on WEDDING_DAY, print-friendly | Vertical axis, engraved ticks | Winding vine, pinned stops |
| Stat | Label + value + provenance (`verifiedAt`) + stale caveat | Numeral plate | Specimen label |
| Field / Input / Select / Radio / Checkbox / Textarea / Fieldset / ErrorSummary | Visible label, 17px input, inline text errors in `error`, `aria-describedby`, error summary focuses first error | Square, gold focus ring | Rounded-sm, moss focus ring |
| Dialog | Focus trap, Esc, `aria-modal`, returns focus; used for lightbox, confirmations, step-up | Curtain open | Leaf settle |
| Badge | Status (RSVP'd, reserved, stale) with text, never colour alone | Engraved chip | Pressed chip |
| MapHandoff | Address text, tap-to-map, provider label, prints full URL | Gold plate | Moss plate |
| Skeleton | Reserves exact dimensions (no CLS); reduced-motion static | Marble shimmer (off in reduced motion) | Paper shimmer (off in reduced motion) |

Kit rule: props and behaviour must be identical across themes; a theme may
change structure inside the component but not its accessible name, focus
order, or states. Adding a component means adding both expressions.

## 7. Motion

Principles (both themes): motion feels like moving through a building or
turning archive pages, never a tech product. Reveal, don't decorate. One
move per surface. Durations 200–600 ms; easing from each theme's DESIGN.md
(no bounce, no elastic). No scroll-jacking, no stagger-spam, no pulsing.

| | Gilded Hour | Conservatory |
|---|---|---|
| Page enter | Curtain / elevator-door split | Leaves settle, content rises |
| Section reveal | Engraved line draws, text fades up | Soft parallax on images only |
| Interaction | Gold rule extends under links | Underline grows, leaf marker nudges |
| Dialog | Curtain | Settle |

`prefers-reduced-motion: reduce` → opacity-only transitions ≤ 200 ms, no
parallax, no transforms, static skeletons, countdown updates without
animation. Reduced motion is a first-class recipe, reviewed in every
critique (`design-motion-principles` audit).

## 8. Accessibility contract

- WCAG 2.2 AA on every page in both themes; axe green on preview
  (`npm run test:a11y`); manual keyboard walk in every self-review.
- Body text ≥ 17px; measure 55–72ch; contrast checked by
  `npx design.md lint` per theme (gold on white is the known risk).
- Visible labels always; placeholder text is never the label; errors are
  text, inline, and summarised.
- RSVP, claim, and preferences are keyboard-complete and screen-reader
  tested (VoiceOver iOS, TalkBack).
- Tap targets ≥ 44×44 with ≥ 8px spacing; sticky bar never covers content
  or focus (WCAG 2.2 focus-not-obscured).
- Focus visible in both themes; skip link first.
- Print styles for logistics pages: hide nav/hero media, show full URLs.
- Times carry weekday and time zone; addresses are complete and tappable.
- Reduced motion per §7; no autoplaying video with sound.
- AI answers are readable as plain text with citations; the concierge is
  never the only way to reach a fact.

## 9. Content model summary

See brief §6 and ADR-0011. Every operational record carries `sourceId`,
`sourceType`, `verifiedAt`, `validFrom/validUntil`, `trustClass`,
`contentVersion`, editor provenance, and renders stale-data UI.

| Model | Shape | Surfaces |
|---|---|---|
| `Story` | Short authored chapters | Our Story, Home teaser |
| `AdventureMemory` | Place, date range, motif tags, body, optional "Sara remembers / Tyler remembers", media refs | Our Adventures, Share an Adventure memory layer |
| `Recommendation` | Practical layer (what/where/hours/link with provenance) + optional memory link; itinerary buckets; `draft` until curated | Share an Adventure, Ask Us |
| `Event` | Name, room (`TODO`), start/end (`TODO`), dress code (`TODO`), accessibility, invitation scope | The Wedding, Your Weekend, Timeline |
| `Space` / `Outlet` | CAA spaces with kit capacities (verify); outlets as live links with `verifiedAt` | Explore CAA, Share an Adventure |
| `Household` / `Guest` / `Invitation` | ADR-0001 | RSVP, Your Weekend |
| `Benefit` | Per-guest entitlement (block link, voucher) with provider state | Your Weekend, Transportation, Travel & Stay |
| `Media` | ADR-0005 rights flags and derivatives | Photos & Video, Gallery |
| `LifecycleState` | ADR-0012 | Shell, Home, Nav |

## 10. Review gates

| Gate | When | Pass |
|---|---|---|
| Brief conformance | Every PR | No fact without a brief row; no "NOT settled" idea as prose |
| Token lint | Every token change | `npx design.md lint` 0 errors × 2 themes; diff explained |
| Critique | Before build and before ship, per theme | Design ≥ 7 · Usability ≥ 8 · Creativity ≥ 7 · Content ≥ 7 |
| Detector | Every PR | `npx impeccable detect` clean or waived with reason |
| Quality | Every PR | `npm run quality` exit 0 |
| Accessibility | Every surface | Axe 0 serious/critical; keyboard walk documented |
| Performance | Every surface on preview | LCP < 2.5 s on a mid-range phone; CLS < 0.1; fonts ≤ 3 files per theme |
| Domain checklist | Every page | `wedding-site-standards` §8 all ticked |
| Self-review | Every level | `docs/reviews/PR-NN-self-review.md` verdict READY |

## 11. Open questions

| # | Question | Owner | Blocks |
|---|---|---|---|
| 1 | Default theme, or random-until-chosen? | Tyler & Sara | Shell, ADR-0009 §4 |
| 2 | Route slugs for the twelve surfaces (proposals in §4) | Integrator | level 03 |
| 3 | Root `DESIGN.md` ("Editorial Romance", Caslon/Newsreader/terracotta) is superseded by the two themes; keep as shared-foundation file or delete? `package.json` lints only the root today | Integrator | Stage 3 gate, CI |
| 4 | Should `Instrument Serif` and script faces join the stylelint ban list (brief lists them; config does not)? | Integrator | level 03 |
| 5 | Imagery ledger is `public/assets/attributions.json` (+ `ATTRIBUTIONS.md`) written by `scripts/fetch-commons.mjs`, policy `docs/ops/asset-licensing.md`; confirm the policy file lands with the assets swarm | Integrator | Stage 2 |
| 6 | Which Chicago airport(s) to recommend and any shuttle | Tyler & Sara + planner | Travel & Stay |
| 7 | Is "Your Weekend" visible pre-claim as a teaser, or hidden until `INVITATIONS_OPEN`? | Tyler & Sara | Nav §3 |
| 8 | Does WEDDING_DAY replace Home with "Today", or add a route? | Integrator | §3, §4 |
| 9 | WebMCP surface: which `read`/`draft` capabilities are exposed in v1? | Integrator | ADR-0002 |
| 10 | Every `TODO(Tyler & Sara)` in §4 — tracked in [`../content/backlog.md`](../content/backlog.md) | Couple / planner / vendors | Content gate |

### Decisions taken by the integrator (2026-09-05)

| # | Decision |
|---|---|
| 1 | Default theme is **Gilded Hour**; the switcher stays visible to everyone (`FLAG_DESIGN_SWITCHER`) and `?theme=conservatory` links are shareable until Tyler & Sara choose. No randomization. |
| 2 | Route slugs in §4 are accepted as proposed. |
| 3 | Root `DESIGN.md` stays as the **shared foundation** (admin surfaces, dev inbox, error pages, e-mail) and the source of the neutral spacing/rounding scale; `npm run design:lint` lints root + every `src/themes/*/DESIGN.md`. |
| 4 | Yes: `Instrument Serif` and script faces join the stylelint ban list. |
| 5 | `docs/ops/asset-licensing.md` lands with the assets swarm at level 02. |
| 7 | "Your Weekend" is hidden until `INVITATIONS_OPEN`; from then on the nav shows "Your invitation" for anonymous visitors and "Your Weekend" once claimed. |
| 8 | On `WEDDING_DAY` the Home recipe becomes "Today"; no extra route. |
| 9 | WebMCP v1 exposes every capability whose `exposure.webmcp` is true: all `read` and `navigate` capabilities, `draft` capabilities, and `action`/`transaction` capabilities only through the explicit-confirmation handshake (`consequentialHint`), never silently. |
