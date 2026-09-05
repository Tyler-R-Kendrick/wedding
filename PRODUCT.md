# PRODUCT.md — Sara + Tyler's Wedding Website

> Durable product truth for every design and build command (impeccable,
> hallmark, frontend-design, design-review). Update this before changing
> the design; it is read by agents at the start of every UI task.
>
> Facts here trace to `docs/design/brief.md` §2. Items marked
> **TODO(Tyler & Sara)** are details only the couple (or their planner)
> can fill in; `docs/content/backlog.md` tracks them. Until they are,
> agents must use obvious placeholder copy and never invent a room, time,
> rate, menu, or story. Public name: **Sara + Tyler**.

## Thesis

Sara and Tyler are inviting the people they love into the places,
experiences, adventures, and memories that shaped their life together, and
helping those guests make memories of their own. The site owns story,
orchestration, and personalization; specialist providers own payments,
flights, hotels, rides, and reservations (ADR-0004). Sara's priorities —
**"Happy, relaxed people"** and **"Dancing"** — are the UX north star:
remove uncertainty, explain clearly, get out of the way.

## Users

**Primary: wedding guests.** Universe ≈ 105 adults + 28 children + 9
plus-ones = 142 (planner agreement anticipates 110–160), across three
generations: the couple's friends (mobile-first, will RSVP from a text
message link), parents' friends and relatives (larger text, less patience
for novelty, may print the page), and out-of-town guests (need travel,
hotel blocks, and a timeline they can trust). Many travel in, including
from California and Nevada; families with children; older relatives;
cost-sensitive travellers; first-time Chicago visitors; some extend into a
weekend. Most visits are on a phone, many in a car, a hotel lobby, or at
the dinner table when someone asks "what's the dress code?"

**Secondary:** the couple (Sara and Tyler) and their wedding party, who
need to preview, check the schedule, and share the link; the planner
(Bustle & Lace) and vendors who may glance at the timeline; guests' own
AI agents reading the schedule through the same capability layer
(ADR-0002).

Guests visit 3–6 times: once when the save-the-date lands (curiosity, "who
are these people, where is it"), once to claim an invitation and RSVP,
repeatedly in the final two weeks for logistics, and again afterward for
photos.

## Mode

**Inform → Act → Celebrate**, in that order of priority — but *story
before utility, utility when it matters*: the home page reconfigures by
lifecycle state (below).

1. **Inform**: date, place, schedule, dress code, travel, parking, FAQ.
   Zero ambiguity, zero scrolling to find the essentials.
2. **Act**: claim invitation, RSVP (household-aware, meal choice, +1
   handling), add to calendar, get directions, book the hotel block, open
   the registry, redeem a ride.
3. **Celebrate**: the couple's story, their adventures, recommendations
   with a memory layer, the building, photos.

The home page must answer "when, where, and what do I do now" above the
fold on a 390px-wide phone in every lifecycle state.

## Purpose

A single, beautiful source of truth for the wedding that guests actually
enjoy opening. It replaces the paper insert card and the group text.
Before the wedding it invites exploration; near the date it becomes
operational; on the day it is a pocket concierge; afterward it is the
permanent archive of a shared weekend. It should feel like a keepsake.

## Operating context

- **Date:** Saturday, July 17, 2027 (`07 · 17 · 27` motif), America/Chicago.
- **Timeline:** TODO(Tyler & Sara) — RSVP deadline (typically 3–4 weeks
  before), save-the-date send date, invitation send date. These drive the
  scheduled lifecycle transitions (ADR-0012).
- **Venue:** Chicago Athletic Association Hotel, 12 S Michigan Ave,
  Chicago, IL 60603 (built 1893; Venetian Gothic; restored as a hotel).
  Indoor. **Which room hosts the ceremony, cocktail hour, and reception is
  TODO(Tyler & Sara)** — candidates from the venue kit are White City
  Ballroom, Madison Ballroom, Stagg Court, The Tank; do not build around
  White City because it photographs best. Valet entrance 71 E Madison with
  a special event valet rate (verify); onsite photography needs advance
  scheduling/permits.
- **Planner:** Bustle & Lace, exclusive planner/coordinator (seating
  charts, floor plans, budget, run-of-day, website guidance, room-block
  guidance, vendor management, design support, rehearsal, day-of). Their
  design materials are their IP and are never ingested.
- **Vendors:** Brooke Alaina Photography (two photographers, ≈6 h second
  shooter, getting-ready through six songs of open dancing,
  photojournalistic; photographer retains copyright, couple has personal
  non-commercial online display rights). Oakhouse Visuals (up to 10 h, one
  videographer; edited ceremony, first dances, toasts; raw footage). Rare
  Bird Beauties (hair and makeup). Band/DJ, catering details, officiant:
  TODO(Tyler & Sara).
- **Guest logistics:** CAA courtesy block up to 20 rooms subject to
  availability, complimentary newlywed suite, two parent upgrades at group
  rate, a standard room as changing room (kit figures, verify).
  TODO(Tyler & Sara) — block rate/URL/dates/room types/cutoff, alternative
  hotels, which airport(s) to recommend, shuttle, Uber voucher
  amount/geography/validity, kid policies (28 children are in the
  universe), plus-one policy (9 plus-ones in the universe), dress code.
- **Privacy:** the site is for invited guests. No visible account
  creation: an invitation link is discovery only; guests claim with an
  email one-time code, passkeys optional, step-up for money/identity
  actions (ADR-0001). Guest pages are `noindex`; no guest names,
  addresses, or table assignments are ever public or in the repo. No IP
  geolocation; personalization only from invitation data and opt-in
  preferences.
- **Content ownership:** copy is written in the couple's voice. Agents
  draft; the couple edits. Photos are the couple's own (engagement shoot:
  TODO(Tyler & Sara)) and, by contract, the professional galleries. AI-
  generated imagery is for *mood boards, comps, and placeholders only* and
  must never ship as a "photo of the couple". Shipping placeholders are
  procedural art (`scripts/generate-art.mjs`) or ledgered Wikimedia
  Commons files. Venue-kit and Hyatt site photography are not reusable.
- **Operational facts** (outlets, hours, rates, links) are records with
  `sourceId`, `verifiedAt`, `validFrom/validUntil` and stale-data UI, never
  hard-coded prose (ADR-0011). The venue kit is already stale (Milk Room
  closed Feb 2025; Cherry Circle Room closed Apr 2024).

## Lifecycle

`TEASER → SAVE_THE_DATE → INVITATIONS_OPEN → RSVP_OPEN → RSVP_CLOSED →
WEDDING_WEEK → WEDDING_DAY → POST_WEDDING → ARCHIVE`. Manual admin
override beats scheduled dates beats wall clock; admin preview is
independent of the calendar (ADR-0012). Navigation collapses and
re-prioritizes by state and identity; see `docs/design/design-doc.md` §3.

## Themes

Two complete, switchable designs over one content layer (ADR-0009):
**Gilded Hour** (Art Deco: marble, gold leaf, sunburst/chevron, stepped
frames, numbered sections, symmetry; Cinzel / Josefin Sans / Big Shoulders
Display) and **Conservatory** (Botanical: foliage, moss, pressed-flower
cards, sky washes over creme, organic asymmetry; Gloock / Spectral / Cardo
italic). Tokens per theme in `src/themes/<id>/DESIGN.md`. Resolution
`?theme=` → cookie → default; switcher visible to everyone until chosen.
Default theme: TODO(Tyler & Sara). Five motifs in both: Adventure, Place,
Memory, Hospitality, Future.

## Constraints

- **Mobile first, then desktop.** 390px is the design canvas; 1440px is the
  showcase.
- **Accessibility is non-negotiable:** WCAG 2.2 AA, 17px minimum body text,
  visible labels, keyboard-complete RSVP and claim flows,
  `prefers-reduced-motion` respected. Grandparents are a primary audience.
- **Fast on hotel Wi-Fi:** LCP under 2.5s on a mid-range phone; images are
  responsive and lazy; fonts self-hosted, ≤ 3 files per theme,
  `font-display: swap` with tuned fallbacks.
- **Printable:** The Wedding, Travel & Stay, Transportation, and Your
  Weekend print legibly in black and white.
- **Low guest friction, managed ops:** no passwords, no visible accounts;
  managed Postgres, storage, and hosting; no CMS beyond the admin surface.
- **Stack:** Next.js 16 App Router + TypeScript + Tailwind v4; Drizzle +
  PGlite (dev/test) + Supabase Postgres (prod); Better Auth (email OTP +
  passkeys); S3-compatible storage (local FS dev, Cloudflare R2 prod);
  Vercel AI SDK 7 with mock models in CI; Vitest + Playwright + axe;
  Vercel hosting (ADR-0008). `DESIGN.md` per theme exports CSS variables.
- **Providers stay authoritative:** never merchant of record; fallback
  ladder API → provider deep link → admin URL → honest unavailable state
  (ADR-0004, ADR-0007).
- **AI is closed-world:** the concierge answers only from site data with
  citations; "I don't have that information" is a success (ADR-0003).

## Legal gates

- Photographer/videographer works: private, non-commercial display OK;
  third-party AI or biometric processing needs written confirmation first
  (`PRO_MEDIA_AI_PROCESSING=false`).
- Illinois BIPA: face matching ships behind `BIOMETRICS_ENABLED=false` with
  a consent ledger, retention/deletion jobs, an isolated vault, and a
  counsel review gate (ADR-0006).
- Planner-created design materials: planner's IP, never ingested.
- Venue-kit photography and Hyatt site imagery: not reusable.
- Historic Michigan Boulevard District designation date is reported
  inconsistently: never publish a date.

## Voice

Warm, plain, a little playful. Second person to guests ("you"), first
person plural for the couple ("we can't wait"). Short sentences. Specific
details over adjectives. Humor is allowed in the FAQ. Gifts are framed as
"help us with our next adventures" — never "cash fund" or "donate".
Every external handoff is explicit ("Continue securely with Uber"). Never
corporate, never "Join us for an unforgettable celebration of love."
Relationship themes in Tyler's own words (best friendship, peace, becoming
better together, being each other's rock, home, gratitude, "greater
together than alone") are the seed for Our Story; the couple edits.

## Anti-references

What this site must **not** look or feel like:

- A SaaS landing page: hero + three feature cards + testimonial grid.
- The default wedding-builder template: centered script font on blush,
  floral watercolor corners, "Mr. & Mrs." clip art.
- "AI look": purple/indigo gradients, glassmorphism, glowing borders,
  bento grids, stock smiling-couple imagery, bouncy micro-animations on
  every element.
- Banned type: Inter, Roboto, Arial, Helvetica, Space Grotesk, Fraunces,
  Playfair, Cormorant, Instrument Serif; no script faces.
- A luxury fashion site so restrained that guests can't find the RSVP.
- A hotel brochure: never clone the CAA kit or Hyatt's site.
- Anything that shames guests (countdown-to-RSVP pressure, "only 3 seats
  left").

## References & evidence

Positive references (see `.claude/skills/wedding-site-standards` for the
full list with what to borrow from each; per-theme boards in
`docs/design/inspo/`):

- Awwwards wedding nominees — cinematic photo pacing, custom type, restraint.
- Bliss & Bone, Riley & Grey — editorial wedding sites: type-led heroes,
  offset image layouts, paper-toned palettes.
- The Knot / Zola / Joy — the *information architecture* guests expect and
  RSVP form conventions.
- Editorial print: invitation suites, letterpress, magazine spreads —
  hierarchy through size and space, not weight and color.
- The building itself: Venetian Gothic, Carrara marble, stained glass,
  walnut, brass — interpreted, never cloned.

## Surfaces (planned routes)

Names are the guests' vocabulary (brief §5). Slugs are proposals for the
scaffold level; states per ADR-0012. Details and 390px fold contracts in
`docs/design/design-doc.md` §4.

| Surface | Route | Job | Visitor mode | Visible from |
|---|---|---|---|---|
| Home | `/` | Names, date, place, state-specific primary action, story teaser | Inform + Act | TEASER |
| Our Story | `/story` | Met → connection → relationship → love → future → engagement → what marriage means | Celebrate | TEASER |
| Our Adventures | `/adventures` | Structured `AdventureMemory` records; "Sara remembers / Tyler remembers" | Celebrate | TEASER |
| Share an Adventure | `/share-an-adventure` | Recommendations with a practical layer and a memory layer; itineraries by duration and mode | Inform + Celebrate | SAVE_THE_DATE |
| The Wedding | `/the-wedding` | Ceremony, cocktail hour, reception; rooms, times, dress code (all TODO), accessibility | Inform | INVITATIONS_OPEN |
| Explore CAA | `/explore-caa` | Docent: building, spaces, history with provenance, live outlet links, "look for this", floor plan with your table | Celebrate + Inform | TEASER |
| Your Weekend | `/your-weekend` | Authenticated hub: invitation, RSVP status, table, benefits, preferences | Act | INVITATIONS_OPEN |
| RSVP | `/rsvp` | Household-aware RSVP: per-event, per-person meal, dietary, +1 per invitation, message | Act | RSVP_OPEN |
| Travel & Stay | `/travel` | Airports, CAA block, alternative hotels, neighbourhood, weather expectations | Inform + Act | SAVE_THE_DATE |
| Transportation | `/transportation` | Valet, transit, rides and voucher, parking, accessibility | Inform + Act | INVITATIONS_OPEN |
| Gifts | `/gifts` | "Help us with our next adventures": registry, experiences, gift cards | Act | RSVP_OPEN |
| Photos & Video | `/photos` | Engagement photos, guest uploads, professional galleries by rights | Celebrate | TEASER |
| Ask Us | `/ask` | Grounded concierge with citations | Inform | TEASER |
| Invitation discovery | `/i/[token]` | Household preview + claim offer; never a session | Gate | INVITATIONS_OPEN |
| Claim | `/claim` | Email OTP → binding; optional passkey | Gate | INVITATIONS_OPEN |
| Admin | `/admin/*` | Lifecycle, content + provenance, moderation, tables | Admin | — |

## Build path

`comp` — comp-first. Every surface gets a full-fidelity comp per theme
(impeccable `craft`, or Stitch via `enhance-prompt`) reviewed with
`design-review` before implementation. This is a small site where design
quality is the whole point, so the slower path is the right one. Process:
`docs/sdlc/PROCESS.md`.
