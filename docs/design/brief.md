# Sara + Tyler — consolidated content and design brief

> Source of truth for every design, content, and engineering decision in this
> repository. Facts below come from Tyler's brief (2026-09-04) and the source
> documents he holds (CAA 2027 wedding kit, Bustle & Lace agreement, Brooke
> Alaina Photography contract, Oakhouse video contract, Rare Bird Beauties
> contract, the "S+T Wedding" planning sheets). Anything not listed under
> **Known facts** is unknown: represent it as a typed `TODO(Tyler & Sara)`
> placeholder, never as plausible fiction. See `docs/content/backlog.md`.

## 1. Thesis

> **Sara and Tyler are inviting the people they love into the places,
> experiences, adventures, and memories that shaped their life together, and
> helping those guests make memories of their own.**

Not a prettier clone of The Knot. The site owns story, orchestration, and
personalization; specialist providers own payments, flights, hotels, rides,
and reservations. Before the wedding it invites exploration; near the date it
becomes operational; on the day it is a pocket concierge; afterward it is the
permanent archive of a shared weekend.

Sara's stated priorities for the wedding: **"Happy, relaxed people"** and
**"Dancing."** That is the UX north star: remove uncertainty, explain things
clearly, then get out of the way of the celebration.

## 2. Known facts (seedable, with provenance)

| Fact | Value | Source |
|---|---|---|
| Couple | Sara Fitzgerald + Tyler Kendrick ("Sara + Tyler") | brief |
| Date | Saturday, July 17, 2027 (`07 · 17 · 27` motif) | brief |
| Venue | Chicago Athletic Association Hotel, 12 S Michigan Ave, Chicago, IL 60603 | brief; CAA kit |
| Planner | Bustle & Lace, exclusive planner/coordinator (seating charts, floor plans, budget, run-of-day, website guidance, room-block guidance, vendor management, design support, rehearsal, day-of) | B&L agreement |
| Guest scale | Planner agreement anticipates 110–160; planning sheet universe ≈105 adults + 28 children + 9 plus-ones = 142 | B&L agreement; planning sheet |
| Guest profile | Many travel in (incl. California/Nevada); families with children; older relatives; cost-sensitive travelers; first-time Chicago visitors; some extend into a weekend | planning correspondence |
| Photography | Brooke Alaina Photography (Brooke Rumbold), two photographers; second shooter ≈6 h; coverage getting-ready through six songs of open dancing; photojournalistic style; photographer retains copyright, couple has personal non-commercial online display rights | photo contract |
| Video | Oakhouse Visuals: up to 10 h, one videographer; edited full ceremony, first dances, toasts; raw footage delivered | video contract |
| Hair & makeup | Rare Bird Beauties: Courtney (bride's Elite makeup), Laura L (Signature hair); previews; +4 makeup, +4 hair services | HMUA contract |
| How they met | At Allison and Jamie's wedding; "flirty glances", immediate connection | brief |
| Memory places | Museum of Ice Cream, Richardson Farm, Michael Jordan's Steakhouse, food tastings, gardening together, Madison waterfront, Starved Rock | brief |
| Starved Rock | Associated with the couple's first "I love you" (trail, date, wording unknown) | brief |
| Relationship themes (Tyler's own writing) | best friendship, peace, becoming better together, mutual support, being each other's rock, home, gratitude, deliberate partnership, "greater together than alone" | brief |
| Tyler's taste | Art Deco; moss | brief |
| Sara's taste | Flowers, plants, foliage | brief |
| Likely palette | White with gold accents; light blue secondary; earthy cremes/light browns as complements; foliage/moss welcome | brief |
| CAA package (kit, verify) | Complimentary newlywed suite; two parent room upgrades at group rate; standard room as changing room; special event valet rate; courtesy block up to 20 rooms subject to availability; onsite photography requires advance scheduling/permits | CAA kit (2025/26) |
| Music references (NOT settled) | Stella Katherine Cole, Haley Reinhart, Puddles Pity Party, Postmodern Jukebox, Michael Bublé; "Simply the Best" (Billie Anne) noted for the aisle | planning sheet |
| Food ideas (NOT settled) | Flavor Tripping, hot-dog ice cream, Esmé, Jeni's Ice Cream, bread as centerpieces | planning sheet |
| Ceremony ideas (NOT settled) | personalized menu cards, thanking guests at ceremony start, quiet couple time at cocktail hour, audience acknowledging someone they love, "vows to the community", children drawing "what love looks like" | planning sheet |
| Registry (NOT settled) | conventional physical wishlist plus experience gifts and gift cards; language "help us with our next adventures" preferred over "cash fund"/"donate" | planning sheet; brief |

### CAA venue facts

Durable (safe as prose, cite): built 1893 for the private Chicago Athletic
Association; Henry Ives Cobb, facade by Louis Christian Mullgardt; Venetian
Gothic after the Doge's Palace; opened amid the 1893 World's Columbian
Exposition; men-only club until 1972; club closed 2007; restored and opened
as a hotel (Hartshorne Plunkard Architecture, interiors Roman & Williams);
patterned brick, carved limestone, arched windows, custom stained glass,
ornate plaster, mosaic/marble floors; Millennium Park and Lake Michigan
views. Contributing building in the Historic Michigan Boulevard District
(designation date reported inconsistently: do not publish a date).

Spaces (from the kit; capacities are kit figures, verify):

| Space | Character | Kit capacity (ceremony / dinner+dance / reception) |
|---|---|---|
| White City Ballroom | floor-to-ceiling windows, vintage stained glass, original Carrara marble floor, three 19th-century fireplaces, 167 restored illuminated ceiling embellishments | 220 / 220 / 300 |
| Madison Ballroom | original walnut parquet, historic crystal chandeliers, millwork, stained glass, city views | 220 / 120 / 250 |
| Stagg Court | the club's original basketball court/gymnasium: original flooring, hoops, elevated running track | 300 / 250 / 350 |
| The Tank | former swimming pool: original pool tile and marble pillars | 175 / 130 / 225 |

Operational (mutable, needs `lastVerifiedAt`, link to official pages, never
hard-coded prose): outlets currently listed on chicagoathletichotel.com are
Cindy's (rooftop), Game Room, Drawing Room, Shake Shack, The Ives, Midōsuji,
Fairgrounds; Topgolf Swing Suite on /about/amenities/; valet entrance 71 E
Madison, accessibility and transit directions on /about/faq/. **The kit is
already stale:** Milk Room closed Feb 2025; Cherry Circle Room closed Apr
2024. Hyatt/CAA site photography is copyrighted and must not be reused.

**Which room hosts the ceremony, cocktail hour, and reception is NOT
confirmed.** Do not build around White City because it photographs best.

## 3. Experience principles

1. Guest simplicity: no visible "account creation"; essentials findable
   without AI; works on mobile Safari/Chrome; progressive enhancement; every
   external handoff is explicit ("Continue securely with Uber").
2. Personalized, not creepy: personalization from invitation data and
   opt-in preferences; no IP geolocation; guests see only what they are
   entitled to; household managers manage RSVP, individuals own benefits.
3. Story before utility; utility when it matters (lifecycle-driven home).
4. Recommendations are personal: every "Share an Adventure" card has a
   practical layer and an optional "Why we're sharing this" memory layer.
   The archive and the guide are two views over one experience graph.
5. Specialist providers stay authoritative; fallback ladder is
   API → provider deep link → admin-configured URL → honest unavailable state.
6. Choose, in order: correctness and authorization; guest simplicity;
   privacy and consent; source-grounded truth; graceful degradation;
   experiential coherence; provider portability; cleverness.

## 4. Visual direction

Historic Chicago × contemporary editorial × personal travel journal. Interpret
the building; never clone the brochure. Materials: warm dark wood,
ivory/stone, Carrara marble, aged brass/gold, stained-glass geometry, rich
natural photography. Motion feels like moving through a building or turning
archive pages, never a tech product.

Two complete, switchable designs (Tyler's choice):

- **Gilded Hour** — Art Deco. White marble ground, gold leaf, sunburst and
  chevron geometry, stepped frames, numbered sections, symmetrical monumental
  layouts. Type: Cinzel (display), Josefin Sans (text/labels), Big Shoulders
  Display (numerals; Chicago's municipal typeface). Motion: curtains,
  elevator doors, engraved reveals.
- **Conservatory** — Botanical. Foliage, moss, pressed-flower cards, light
  blue sky washes over creme, botanical line-art borders, organic asymmetry.
  Type: Gloock (display), Spectral (text), Cardo italic (accents). Motion:
  leaves settling, soft parallax. No script faces.

Shared palette family: white/ivory, gold, light blue, creme/light brown,
foliage/moss greens. Anti-references for both: centered-script-on-blush
templates, watercolor floral corners, SaaS hero + three cards, glassmorphism,
purple gradients, glows, bento grids, bouncy motion, Inter/Roboto/Arial/
Helvetica/Space Grotesk/Fraunces/Playfair/Cormorant/Instrument Serif.

Five motifs: **Adventure, Place, Memory, Hospitality, Future.**

## 5. Information architecture

Home · Our Story · Our Adventures · Share an Adventure · The Wedding ·
Explore CAA · Your Weekend (authenticated) · Travel & Stay · Transportation ·
Gifts · Photos & Video · Ask Us (concierge). Navigation collapses and
re-prioritizes by lifecycle and identity; mobile information scent beats
exposing everything.

Lifecycle: `TEASER → SAVE_THE_DATE → INVITATIONS_OPEN → RSVP_OPEN →
RSVP_CLOSED → WEDDING_WEEK → WEDDING_DAY → POST_WEDDING → ARCHIVE`, with
manual admin override and preview independent of wall-clock date.

## 6. Content model summary

Our Story (short, authored: met → connection → relationship → love → future
→ engagement → what marriage means). Our Adventures (expansive, structured
`AdventureMemory` records with optional "Sara remembers / Tyler remembers").
Share an Adventure (`Recommendation` linked to memories; itineraries for 45
min / 2–3 h / Friday afternoon / Saturday morning / with kids / architecture /
food & drink / stay inside CAA — drafts until curated). CAA docent
(building, spaces, history with provenance, on-property outlets as live
links, self-guided "look for this" details, floor plans with the guest's
table when published). Everything operational carries `sourceId`,
`verifiedAt`, `validFrom/validUntil`, editor provenance, stale-data UI.

## 7. Rights and legal gates

- Photographer/videographer works: private, non-commercial display OK;
  third-party AI or biometric processing needs written confirmation first
  (`PRO_MEDIA_AI_PROCESSING` flag OFF).
- Planner-created design materials are the planner's IP: never ingest.
- Illinois BIPA: face matching ships behind `BIOMETRICS_ENABLED=false` with
  consent ledger, retention/deletion, isolated vault, counsel review gate.
- Venue-kit photography and Hyatt site imagery: not reusable.
