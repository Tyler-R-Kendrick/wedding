---
name: wedding-site-standards
description: Wedding-website domain knowledge for Tyler & Sara's site — the information architecture guests expect (from The Knot, Zola, Joy), RSVP and privacy conventions, content checklists per page, the Awwwards judging rubric, and a curated list of award-level wedding sites to study. Use whenever designing, building, reviewing, or writing copy for any wedding-site page, the RSVP flow, the schedule, travel, registry, FAQ, story, wedding party, or photo gallery — even if the request doesn't say "wedding".
version: 1.0.0
---

# Wedding site standards

Read this before any page, component, or copy work. It sets **what** a
wedding site must contain and **how good it must be**. Visual direction
lives in `DESIGN.md`; product truth lives in `PRODUCT.md`.

## 1. The job of the site, in order

1. **Answer logistics instantly**: who, when, where, what to wear, how to
   RSVP. Above the fold on a 390px phone. No scrolling to find the date.
2. **Make acting easy**: RSVP, add-to-calendar, directions, book hotel,
   registry. One primary action per screen.
3. **Feel like the couple**: story, photos, wedding party, details.

If a design choice makes 3 better and 1 or 2 worse, it loses.

## 2. Pages guests expect (industry IA, mapped to this site)

Synthesized from The Knot, Zola, and Joy builders plus 2026 comparisons,
then mapped onto the twelve surfaces in `docs/design/brief.md` §5. Guests'
vocabulary wins in navigation labels; our surfaces carry the concept.

| Surface (route) | Industry equivalent | Must contain | Nice to have |
|---|---|---|---|
| **Home** (`/`) | Home | Both names, date with weekday, city/venue, countdown, primary action for the lifecycle state (Save the date → RSVP → Today), RSVP deadline once open | Story teaser, hero image, add-to-calendar |
| **Our Story** (`/story`) | Our Story | Short authored narrative: met → connection → love → future → engagement → what marriage means | Timeline, fun facts |
| **Our Adventures** (`/adventures`) | Photos / "About us" | Browsable memory archive (AdventureMemory records) with optional "Sara remembers / Tyler remembers" | Map view, seasons |
| **Share an Adventure** (`/share-an-adventure`) | Things to do | Recommendations with a practical layer (what, where, duration, distance from CAA, cost, accessibility, booking/directions) and a "Why we're sharing this" memory layer; itineraries by time available and interest (with kids, architecture, food, stay inside CAA) | Post-wedding guest contributions |
| **The Wedding** (`/wedding`) | Schedule / Events | Every event a guest is invited to: name, date, start/end, venue space + address (tap-to-map), dress code per event, what happens | Shuttle times, parking note, what to bring |
| **Explore CAA** (`/explore-caa`) | Venue | Building overview, spaces, history with provenance and `lastVerifiedAt`, on-property outlets as live links, parking/valet/accessibility fields, "look for this" details | Floor plan with the guest's table when published |
| **Your Weekend** (`/your-weekend`, claimed guests) | (none) | Personal schedule, household, RSVP status, table once published, transport benefit, trip items, urgent updates | Free-time suggestions |
| **Travel & Stay** (`/travel`) | Travel & Accommodations | Airports (ORD/MDW), CAA block first (code + cutoff once known), hand-vetted alternatives with the couple's reasons, transport options, parking | Things to do, weather |
| **Transportation** (`/transportation`) | (part of Travel) | Airport→hotel, "do I need a car", getting home after the reception, voucher claim when eligible, CTA/taxi/accessible transit | — |
| **Gifts** (`/gifts`) | Registry | Provider handoff (The Knot / Zola / Joy), "help us with our next adventures" framing, gracious cash-fund language | Thank-you tracking |
| **Photos & Video** (`/photos`) | Photos | Engagement gallery now; guest uploads + professional chapters after (Full Ceremony · Toasts · First Dances · Guest Videos · Professional Films) | Semantic search, opt-in find-me |
| **Ask Us** (`/ask`) | FAQ | FAQ content (dress code with examples, kids, plus-ones, parking, weather, photo policy, venue accessibility, contact) plus the grounded concierge | — |

Identity model: no visible accounts. A high-entropy invitation link identifies
the household (discovery only); the guest picks who they are and claims with
an email OTP; a persistent session and optional passkey handle returns.
Guests treat this as normal because The Knot / Zola / Joy already gate
private details behind a similar "find your invitation" step. Default to
`noindex` for guest surfaces.

## 3. RSVP flow rules (the highest-stakes UI)

- **Household look-up by name**, tolerant of nicknames and typos; never
  require an invite code that guests will lose.
- Per-event accept/decline; per-person meal choice with allergy free text.
- Plus-ones are shown only when the invitation includes one.
- Deadline is stated on the form and on Home. Typical: 3–4 weeks before
  the wedding (The Knot guidance). No pressure timers.
- Every field has a **visible label**; errors are inline text in
  `colors.error`, never color alone; 17px inputs (iOS won't zoom).
- Keyboard-complete; focus visible; works with VoiceOver/TalkBack.
- Confirmation screen restates what was submitted and how to change it.
- Works offline-ish: if the backend fails, show a friendly retry with the
  couple's contact, never a dead end.

## 4. Copy standards

- Couple's voice, second person to guests, short sentences (see
  `PRODUCT.md › Voice`). Specific > adjectival.
- Dates always with weekday and year: "Saturday, June 12, 2027".
- Times with time zone if guests travel: "4:00 pm PT".
- Addresses complete and tappable; add "(parking behind the barn)".
- Dress codes explained in one sentence with an example outfit for each
  gender-neutral reading ("cocktail: a suit or a dress; the lawn is grass,
  so skip stilettos").
- FAQ answers are honest and kind; humor allowed.
- **Never invent facts.** Use `TODO(Tyler & Sara)` placeholders where
  details are unknown; obvious placeholder copy, never plausible fiction.

## 5. Quality bar: the Awwwards rubric, applied

Awwwards jurors score **Design 40% · Usability 30% · Creativity 20% ·
Content 10%**. Use these as the review axes and score 1–10 each.

- **Design (40)**: typographic hierarchy, composition, photo pacing,
  restraint, consistency with `DESIGN.md`, no AI-slop tells.
- **Usability (30)**: logistics findable in ≤2 taps, RSVP completable in
  <2 minutes on a phone, WCAG 2.2 AA, LCP < 2.5s, prints cleanly.
- **Creativity (20)**: at least one idea that is *theirs* — a typographic
  monogram, a hand-drawn map, a story told as a timeline, a countdown that
  becomes a photo on the day. One strong idea beats five effects.
- **Content (10)**: real photos, real words, complete logistics.

A page ships when every axis ≥ 7 and Usability ≥ 8.

## 6. What award-level wedding sites do (study list)

Study these with `hallmark study <url>` or `/impeccable critique` before
designing a surface. Borrow *principles*, never layouts or assets.

- **Awwwards wedding nominees** — search
  <https://www.awwwards.com/websites/?text=wedding>. Known examples:
  "The Wedding of Lucy and Si" (animation + restraint), "OurNine9 — Eric &
  Nikki" (bright typographic hero), "Arpeeta & Arpan" (full RSVP flow
  inside an editorial site). Borrow: a single confident type idea; photo
  pacing with generous whitespace; motion that reveals, never decorates.
- **Bliss & Bone** <https://www.blissandbone.com> — the design-first
  builder; editorial layouts, paper tones, type-led heroes. Borrow:
  offset image placement, small-caps eyebrows, restraint.
- **Riley & Grey** <https://www.rileygrey.com> — best-in-class RSVP UX
  inside designed templates. Borrow: RSVP flow structure and copy tone.
- **The Knot / Zola / Joy** — the IA and feature baseline in §2. Borrow:
  page names, FAQ essentials, registry etiquette.
- **Editorial print**: letterpress invitation suites, magazine spreads.
  Borrow: hierarchy through size and space; hanging punctuation; hairlines.

Anti-references (do not borrow): centered-script-on-blush templates,
watercolor floral corners, SaaS hero + 3 cards, glassmorphism, purple
gradients, bouncy scroll animations. See `PRODUCT.md › Anti-references`.

## 7. Mobile & print non-negotiables

- 390px is the design canvas. Sticky bottom bar on Home: **RSVP** +
  **Directions**.
- Tap targets ≥ 44×44px; body text ≥ 17px; line length 55–72ch.
- Schedule, Travel, FAQ print legibly in black & white (`@media print`:
  hide nav/hero video, show full URLs for map links).
- `prefers-reduced-motion` disables all non-essential motion.
- Images: responsive `srcset`, AVIF/WebP, explicit dimensions (no CLS),
  lazy below the fold, hero preloaded.
- Fonts: self-hosted, ≤3 files, `font-display: swap`, metric-matched
  fallbacks.

## 8. Checklist to run before calling a page done

- [ ] Names, date, place visible without scrolling (Home)
- [ ] Every address is a tap-to-map link; every time has a weekday
- [ ] RSVP deadline appears on Home and RSVP
- [ ] Dress code explained with an example
- [ ] Hotel block: code + cutoff date
- [ ] FAQ covers kids, plus-ones, parking, weather, photos, accessibility
- [ ] Invitation-claim flow + `noindex` on guest surfaces in place
- [ ] `design-review` skill run: score ≥ 7/7/7/7 and Usability ≥ 8
- [ ] `npm run quality` green; `npm run test:a11y` green against preview
- [ ] No `TODO(Tyler & Sara)` left on a shipped page

## Sources

- The Knot — what to put on your wedding website:
  <https://www.theknot.com/content/what-to-put-on-your-wedding-website>
- The Knot — essential FAQ page: <https://www.theknot.com/content/wedding-website-faq-page>
- Joy — what to put on your wedding website: <https://withjoy.com/blog/what-to-put-on-your-wedding-website/>
- Zola wedding website features: <https://www.zola.com/wedding-planning/website>
- Carats & Cake, best wedding websites 2026 (Bliss & Bone for design, Riley & Grey for RSVP): <https://caratsandcake.com/articles/best-wedding-websites>
- Awwwards: <https://www.awwwards.com/websites/sites_of_the_day/>
