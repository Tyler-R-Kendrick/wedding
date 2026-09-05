# Conservatory — inspo board (text edition)

Theme two of two for Sara + Tyler. Companion to `conservatory.html` (same
content, rendered) and the source of truth for the theme's tokens,
`src/themes/conservatory/DESIGN.md` (lints 0 errors / 0 warnings) with the
sidecar `src/themes/conservatory/design.json`. Facts come only from
`docs/design/brief.md`; anything else is `TODO(Tyler & Sara)`.

## 1. North star

**The Herbarium Sheet.** A glasshouse in July: creme paper, a light-blue
wash where the sky shows through the glazing, moss and leaf greens doing the
work of ink, one thread of pollen gold. Every page is laid down like a
pressed specimen: off-centre, labelled in italic on kraft, sometimes
overlapping the sheet beneath. Sara's taste (flowers, plants, foliage) with
Tyler's moss. The palm court, where Gilded Hour is the ballroom.

Atmosphere (taste-design vocabulary): density **airy 3/10**, variance
**offset asymmetric 6–7/10**, motion **fluid 4–5/10**.

Mood words: glasshouse in July · pressed, not printed · moss on limestone ·
hand-set label · sky through glazing · unhurried · sunlit paper · layered
sheets · happy, relaxed people · dancing.

Anti-references: centred script on blush · watercolor corner florals ·
pastel-pink gradient · "Mr. & Mrs." clip-art · hero + three cards · bento
grid · glassmorphism · purple gradient · bouncy easing · Playfair /
Cormorant / Fraunces · Inter / Space Grotesk · falling-petal loops ·
faux-aged paper textures.

## 2. Palette and rationale

| Token | Hex | Job | Contrast (vs its ground) |
|---|---|---|---|
| `primary` Moss Ink | #2A4430 | all text, primary button, after-dark sections | 9.22 on creme · 10.06 on ivory · 8.27 on parchment · 8.19 on sky · 7.43 on kraft · 8.26 on moss-wash |
| `on-primary` | #F4EEDF | text on ink | 9.22 |
| `secondary` Moss | #4F6338 | eyebrows, focus ring, memory tags | 5.72 on creme · 6.24 on ivory · 5.13 on parchment |
| `on-secondary` | #F4EEDF | text on moss chips | 5.72 |
| `tertiary` Pollen | #D4B24A | RSVP button, tag thread, the "+" | ink on it 5.22 |
| `on-tertiary` | #2A4430 | text on pollen | 5.22 |
| `leaf-deep` Leaf Ink | #3F5F33 | links, primary hover, ornament strokes | 6.26 on creme · 6.84 on ivory · 5.61 on moss-wash |
| `leaf` | #7E9C5F | **ornament fill only** | ink on it 3.46 → fails AA, so never text |
| `moss-wash` | #DFE5CF | alternate section fill | ink on it 8.26 |
| `sky` | #D4E4EC | operational bands (wedding week, countdown, weather) | sky-ink on it 7.22 |
| `sky-ink` | #2B4A5A | text on sky | 7.22 on sky · 8.14 on creme |
| `kraft` | #E4D6BA | specimen tags, nav tags, household card | soil on it 4.80 · ink on it 7.43 |
| `kraft-deep` | #C9B48C | rule under tags, chips | ink on it 5.28 |
| `soil` | #6E5637 | captions, specimen-label text, credits | 5.95 on creme · 6.49 on ivory · 4.80 on kraft |
| `neutral` Creme | #F4EEDF | the page | — |
| `neutral-variant` Parchment | #EAE2CE | RSVP and travel ground | ink 8.27 |
| `surface` Ivory Sheet | #FBF8F1 | cards | ink 10.06 |
| `on-surface-muted` | #4F5A48 | secondary copy | 6.85 on ivory · 6.28 on creme · 5.63 on parchment |
| `outline` | #C8C1AC | hairlines, input borders (decorative) | 1.55 vs creme, never text |
| `error` / `on-error` | #8B3A2B / #FFF5F0 | RSVP validation | 7.23 on ivory · pair 7.15 |

**Rationale.** The brief's "likely palette" is white with gold, light blue,
creme/light brown, and foliage/moss. Conservatory takes the brief literally
but assigns roles so the pale colours can never become text: light blue and
pale green are *washes* (The Wash Rule), and gold is a *thread* (The Pollen
Rule: at most twice per viewport). The one deliberate difference from the
editorial baseline (`/DESIGN.md`) is that there is no terracotta; the accent
is pollen and the ink is green rather than green-black, so the two systems
read as different rooms rather than as a recolour. Neutrals are tinted
toward the moss hue (no zero-chroma greys).

The ui-ux-pro-max palette index was searched for comparison (`--domain
color`: "botanical garden natural organic green", "wedding elegant ivory
sage"). It returned a saturated Tailwind-green + floral-pink "Florist/Plant
Shop" set and a "Wedding/Event Planning" pink-and-gold set; both are the
saturated, pure-white-card defaults the brief rejects, and neither has a
paper ground. They were useful as a boundary, not as a source.

Every component pair in the frontmatter (lowest first): specimen-label 4.80
· button-accent 5.22 · eyebrow 5.72 · tag-moss 5.72 · caption 5.95 ·
button-primary-hover 6.26 · link 6.26 · card-muted-text 6.85 · banner-error
7.15 · banner-sky / countdown 7.22 · input-error 7.23 · nav 7.43 ·
section-alt 8.26 · section-parchment 8.27 · button-primary / nav-current /
section-inverse / hero / titles / prose 9.22 · card / card-pressed / input /
button-ghost 10.06. All AA.

## 3. Type and rationale

| Role | Face | Files | Why |
|---|---|---|---|
| Display (`display-xl`, `display-lg`, `h1`, `h2`, `numeral`) | **Gloock** 400 (OFL, Duarte Pinto) | 1 | High-contrast display serif with curled terminals: engraved, botanical, one weight so hierarchy is size and space. Always roman. |
| Text (`h3`, `body-*`, `label-*`) | **Spectral** 400/500 + italic (OFL, Production Type) | 2 | Screen-tuned text serif; true italic; real small caps (`smcp`) so eyebrows and tags are small capitals, not tracked uppercase. `body-md` = 17px / 1.65. |
| Specimen labels (`specimen-label`) | **Cardo** italic (OFL, David Perry) | 1 | Scholarly Bembo-style italic: the handwritten Latin on a herbarium label. Two slots only, never headings or buttons. |

Alternatives compared (ui-ux-pro-max `--domain typography`):

- "Wedding/Romance": Great Vibes + Cormorant Infant → rejected; script on
  serif is the banned template look, Cormorant is an anti-reference.
- "Classic Elegant": Playfair Display + Inter → rejected; both banned by the
  brief and by `lint:css`.
- "Editorial Classic": Cormorant Garamond + Libre Baskerville → rejected;
  Cormorant banned, Baskerville too cool and bookish for a glasshouse.
- Runner-up: Libre Caslon Display + Newsreader → already the repo baseline;
  Conservatory must not read as a recolour of it.

Verified: all three families resolve on the Google Fonts CSS API with the
weights above; licences read from `google/fonts` `METADATA.pb` (all OFL).
Total ≤ 4 font files, within the "≤3 files" target only if Spectral italic
is subset to the memory-tag and emphasis glyphs; otherwise accept four.

Scale: display-xl 4.25rem/1.0 (fluid to 2.75rem on phones) · display-lg
3rem · h1 2.25rem · h2 1.625rem · h3 1.25rem (Spectral 500) · body-lg
1.25rem · body-md 1.0625rem · body-sm 0.9375rem · label-lg 1rem/1 ·
label-caps 0.8125rem smcp 0.1em · specimen-label 1rem italic · numeral
2.5rem tnum/lnum.

## 4. Spacing, shape, depth, motion

- **Spacing** 4 · 8 · 16 · 24 · 40 · 64 · 96 · 144. Section rhythm 96 desktop
  / 64 mobile, but sections change by wash (sky, moss, parchment, inverse)
  and by fern dividers that grow 12rem from the left margin and stop.
- **Shape** sheets and specimen labels `0px` (paper is cut; a rule never
  meets a rounded corner), nav tags, chips and inputs `2px`, buttons `8px`. No pills (baseline's signature), no stepped frames (Gilded Hour's).
- **Depth** paper on paper: flat sheets on creme with a hairline and no
  shadow; pressed cards drop the hairline and carry only `0 1px 0 rgba(42,68,48,.06), 0 12px 32px -20px rgba(42,68,48,.35)`
  and a ±1.2–1.6° tilt; the sticky mobile bar has `0 -8px 24px
  rgba(42,68,48,.08)`. Nothing else casts a shadow.
- **Motion** `ease-settle cubic-bezier(.22,.61,.36,1)`, 700ms, 80ms stagger,
  at most five sheets per page; sky washes drift ≤ 12px; hover is colour and
  underline thickness only; reduced motion renders everything at rest.

## 5. Ornament inventory (generated)

`node scripts/generate-art.mjs conservatory` → `public/assets/art/conservatory/`
(11 SVGs + `manifest.json`; deterministic; theme colours only; no external
references; each has `viewBox`, `role="img"`, and a `<title>`).

| File | Size | Use |
|---|---|---|
| leaf-border.svg | 1200×80 tile | hero top edge, nav-rail thread; one edge only |
| fern-divider.svg | 480×48 | replaces the 12rem hairline between chapters |
| moss-cluster-sm/md/lg.svg | 64 / 128 / 240 | list bullet · under a card corner · behind the after-dark title |
| tendril-corner.svg | 200×200 | RSVP household card, password gate; one per page |
| specimen-tag.svg | 320×140 | comp reference for the kraft label (`TODO(Tyler & Sara)` placeholder; "Chicago · 07 · 17 · 27") |
| sky-wash.svg | 1440×640 | ground of sky bands; the one soft edge |
| pressed-flower-a/b/c.svg | 220×220 | bloom · umbel · bells; one per pressed card, cropped by a corner |

## 6. Layout logic (wireframes, described)

- **Home · TEASER · 390**: leaf border top-right; "Sara + Tyler" left in
  Gloock with the "+" in pollen; a kraft tag "Chicago · 07 · 17 · 27" hanging
  off the names; story teaser; the first pressed card overlapping the fold;
  floating kraft "Menu" tag; sticky bar "Add to calendar" + "Travel & Stay".
- **Home · WEDDING_WEEK · 390**: the sky band rises to the top with names,
  the full date, the countdown in tabular Gloock and a "Today" tag; today's
  schedule on an ivory sheet with a pollen mark on the current item; bar
  switches to "Your Weekend" + "Directions".
- **Share an Adventure card · 390**: one large pressed card: specimen tag
  top-right, practical layer (address, hours, "Open in Maps", "Continue with
  Uber"), fern rule, then "Why we're sharing this" with `tag-moss` "Sara
  remembers" / "Tyler remembers"; bloom cropped bottom-right, moss cluster
  under the opposite corner.
- **Our Story · 1440**: kraft tag rail on the left (current tag inverted,
  tilted 3°, pollen knot); chapters in columns 1–7 with fern dividers;
  memory sheets overlapping at −1.5° / +1.8° / −1° in the mounting area.
- **RSVP · 390**: parchment ground; kraft household card with tendril
  corner; labels above 17px fields; accept/decline as two buttons; meal and
  notes; error in words; one pollen "Send RSVP".
- **RSVP · 1440**: same form in the left column; a live "What you're
  sending" sheet overlapping in the mounting area; "Questions? Ask Us" on a
  small sheet beneath.

Nav pattern: **specimen-tag rail** (desktop) / **Menu tag + two-action
bottom bar** (mobile). Never a centred horizontal bar.

## 7. References: borrow / avoid

Awwwards botanical tag (https://www.awwwards.com/websites/botanical/,
fetched 2026-09-05). The listing names sites and generic traits only; none
was audited page by page. Run `hallmark study <url>` before borrowing
anything specific.

- **Botanic Expo (Enrico Deiana; listed SOTD + Developer Award, Aug 31
  2024)** — borrow: one botanical idea carrying a whole page, low colour
  count. Avoid: GPU-hungry experiences; grandparents on hotel Wi-Fi.
- **Fonds de dotation botanic® (Walt)** — borrow: institutional calm.
  Avoid: full-bleed photography doing all the work (Hyatt/CAA imagery is
  not reusable; AI imagery never ships as a photo of the couple).
- **BOTANICAL REFRESH'21 — BOTANIST (dbweb-ga)** — borrow: label typography
  as a device (maps to specimen labels). Avoid: campaign density, motion on
  every scroll step.
- **Clark's Botanicals (85SIXTY)** — borrow: an editorial grid that
  tolerates asymmetry. Avoid: the shop macrostructure.
- **Herbarium sheets** (digitised sheets at Harvard University Herbaria,
  Kew, the Field Museum in Chicago; Emily Dickinson's herbarium at Houghton
  Library) — borrow the format: specimen off-centre with breathing room,
  label bottom-right, accession stamp, hairline. Avoid: faux-aged textures.
- **Chicago conservatories (verified 2026-09-05)** — Lincoln Park
  Conservatory: built in phases 1890–1895, Joseph Lyman Silsbee with M.E.
  Bell; Palm House, Fern Room, Orchid House, Show House
  (chicagoparkdistrict.com). Garfield Park Conservatory: opened 1908;
  Garfield Park Conservatory Alliance (formed 1998) with the Chicago Park
  District (garfieldconservatory.org). Borrow: room names as a section
  model; glass-and-iron light as the sky wash. Avoid: implying any event is
  held there. The venue is the Chicago Athletic Association Hotel.
- **Study list from `wedding-site-standards`** (Bliss & Bone, Riley & Grey,
  Awwwards wedding nominees) still applies for RSVP flow and photo pacing.

## 8. How this differs from Gilded Hour

| Axis | Gilded Hour (brief §4) | Conservatory |
|---|---|---|
| Layout | symmetrical, monumental, centred axis, stepped frames | left-weighted herbarium sheet; overlapping tilted cards; nothing centred by default |
| Rhythm | numbered sections, grand reveals | washes and fern dividers from the margin; no numbering |
| Nav | centred bar, engraved labels | kraft tag rail left; Menu tag + two-action bar on phones |
| Ornament | gold leaf, sunburst, chevron | line-art leaves, ferns, tendrils, moss, pressed blooms; gold as a pollen thread |
| Type | Cinzel, Josefin Sans, Big Shoulders Display | Gloock, Spectral, Cardo italic; small caps not uppercase |
| Colour | white marble, gold | creme paper, moss ink, sky and moss washes, kraft, soil |
| Motion | curtains, elevator doors, engraved reveals | leaves settling, soft parallax, slow reveals |
| Metaphor | the ballroom | the palm court |

Test: with colour removed, the layouts alone must tell the two apart.

## 9. Self-score (Awwwards axes, `wedding-site-standards` §5)

Design 8 · Usability 8 · Creativity 8 · Content 6. Ship gate is ≥7 on every
axis and Usability ≥8; Content is expected to stay below 7 until Sara and
Tyler supply copy and the specimen names.

Hallmark pre-emit critique of the board: P4 H4 E4 S5 R4 V4 (all ≥ 3).

## 10. Decisions and open questions

Decisions
- Green ink (`#2A4430`) rather than the baseline's green-black, and no
  terracotta: the two systems must read as different rooms.
- `leaf` is fill-only; the linter would otherwise flag any text on it.
- Buttons at 8px corners (not pills, not square) to stay distinct from both
  the baseline and Gilded Hour.
- Cardo italic limited to two slots; headings are always roman.
- Eyebrows are optional and stack above the title in the same column; no
  eyebrow-beside-heading rows and no eyebrow on every section.
- Ornament is generated, not drawn by hand or licensed.

Open questions for Tyler and Sara
- Which plants belong on the specimen labels (a bouquet flower, moss from
  Starved Rock)?
- Is the pollen "+" the monogram, or should there be a drawn one?
- Should the tag rail carry page names or CAA room names?
- Should the wedding-week sky band show live weather?
- Which of the three pressed-flower silhouettes (bloom, umbel, bells) reads
  as "theirs"?
