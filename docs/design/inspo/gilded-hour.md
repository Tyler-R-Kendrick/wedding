# Gilded Hour — inspiration board (text form)

> Theme 1 of 2 (Art Deco, Tyler's taste). Companion to `gilded-hour.html` (the designed
> board), `src/themes/gilded-hour/DESIGN.md` (tokens), `src/themes/gilded-hour/design.json`
> (sidecar), and `scripts/art/gilded-hour.mjs` (procedural ornament). Facts only from
> `docs/design/brief.md`; anything else is `TODO(Tyler & Sara)`. Board date 2026-09-05.

## 1. Direction

**North star: "The Gilded Hour."** The hour when the late sun comes across Michigan
Avenue and turns a marble room gold. An 1893 private club (Venetian Gothic, Carrara
marble ballroom floor) borrowed for the 1920s' confidence and set for 2027. A plaque,
not a poster.

- Mood words: engraved, gilded, monumental, calm, hospitable, exact, lake-lit, unhurried.
- Dials: density 2/10 (art-gallery airy), variance 3/10 (predictable symmetric),
  motion 3/10 (restrained).
- Sara's north star ("happy, relaxed people", "dancing") means monumentality lives in
  the frame, never in the effort: big axis, big margins, few things per screen, one
  reveal per page.
- Five motifs order the home page and the story: Adventure, Place, Memory, Hospitality,
  Future. Only real sequences get numerals.

## 2. Palette and rationale

White marble ground (never #fff), gold leaf as ornament, bronze as the gold that can be
read, lake blue as the second voice, creme as the earthy complement, moss as a note for
foliage content, oxblood for errors.

| Name | Token | Hex | Role |
|---|---|---|---|
| Lacquer Ink | primary | #1C1B18 | Text, primary button, evening sections |
| Carrara Marble | neutral | #F8F6F1 | The page ground |
| Polished Marble | surface | #FDFCFA | Cards and inputs |
| Creme | neutral-variant | #EDE5D6 | Alternate sections, travel and stay |
| Hairline | outline | #D8CFBF | Quiet rules and borders |
| Gold Leaf | gold | #C9A648 | Ornament only; headings on ink |
| Gold Wash | gold-wash | #F3EAD0 | Numeral plaques, hover tint |
| Bronze | tertiary | #7A5A16 | The gold you can read: links, RSVP |
| Lake Blue | secondary | #2E5B7B | Eyebrows, current nav, focus, success |
| Lake Wash | lake-wash | #CFE0EB | Your Weekend panel, focused inputs |
| Moss | moss | #4F5F3F | Foliage labels only |
| Muted Stone | on-surface-muted | #5E5A52 | Captions and helper text |
| Oxblood | error | #8E2E22 | RSVP validation only |

**Why two golds.** Gold on white is a contrast trap (2.15:1). Splitting gold into an
ornament color (`gold`) and a text color (`tertiary`, Bronze, 5.89:1 on marble) keeps
the Deco feeling without a single failing pair. Gold Leaf is allowed as text only on
Lacquer Ink (7.41:1), which is where Deco gold historically lives anyway.

**Why lake blue is deep, not pale.** The brief's "light blue secondary" is carried as a
wash (`lake-wash`, fills only) and a readable deep lake (`secondary`, 6.71:1) so blue
can label and confirm without ever becoming a pale-blue-text accessibility failure.

**Why moss is a token at all.** Sara's taste is foliage; Gilded Hour is not the botanical
theme, but the adventure and garden content (Richardson Farm, Starved Rock, gardening
together) deserves one honest green label. It is never a fill larger than a tag.

### Computed contrast (WCAG 2.2 relative luminance)

| Text | Ground | Hex pair | Ratio | Grade | Used by |
|---|---|---|---|---|---|
| Lacquer Ink text | Carrara Marble | #1C1B18 on #F8F6F1 | 15.95:1 | AAA | body, headings |
| Lacquer Ink text | Creme | #1C1B18 on #EDE5D6 | 13.76:1 | AAA | section-alt |
| Lacquer Ink text | Lake Wash | #1C1B18 on #CFE0EB | 12.72:1 | AAA | section-lake, input-focus |
| Lacquer Ink text | Gold Wash | #1C1B18 on #F3EAD0 | 14.34:1 | AAA | numeral-badge |
| Marble text | Lacquer Ink | #F8F6F1 on #1C1B18 | 15.95:1 | AAA | button-primary, section-inverse |
| Gold Leaf heading | Lacquer Ink | #C9A648 on #1C1B18 | 7.41:1 | AAA | section-inverse-heading |
| Bronze text | Carrara Marble | #7A5A16 on #F8F6F1 | 5.89:1 | AA | link, RSVP label |
| Bronze text | Creme | #7A5A16 on #EDE5D6 | 5.08:1 | AA | links on section-alt |
| Marble text | Bronze | #FBF9F4 on #7A5A16 | 6.05:1 | AA | button-accent |
| Lake Blue text | Carrara Marble | #2E5B7B on #F8F6F1 | 6.71:1 | AA | eyebrow, nav-current |
| Marble text | Lake Blue | #F8F6F1 on #2E5B7B | 6.71:1 | AA | banner-success |
| Muted Stone text | Carrara Marble | #5E5A52 on #F8F6F1 | 6.35:1 | AA | countdown-label, captions |
| Muted Stone text | Creme | #5E5A52 on #EDE5D6 | 5.48:1 | AA | captions on section-alt |
| Moss text | Carrara Marble | #4F5F3F on #F8F6F1 | 6.39:1 | AA | label-moss |
| Oxblood text | Polished Marble | #8E2E22 on #FDFCFA | 7.99:1 | AAA | input-error |
| Marble text | Oxblood | #FFF5F2 on #8E2E22 | 7.64:1 | AAA | banner-error |
| Gold Leaf as text | Carrara Marble | #C9A648 on #F8F6F1 | 2.15:1 | fails | never: ornament only |

## 3. Typography and rationale

- **Cinzel** (display, weight 500 only): Roman capitals drawn for screens; the closest
  thing on Google Fonts to letters cut into the CAA limestone. Tracked 0.04–0.06em.
  Never below 24px, never running text. OFL (Natanael Gama), verified on the Google
  Fonts CSS API 2026-09-05.
- **Josefin Sans** (text, labels, nav, forms): a 1920s geometric with signboard
  proportions and seven weights. Small x-height, so body is 18px (`body-md`) and never
  below 17px (`body-sm`); labels 13px uppercase at 0.18em, used only where they carry
  structure. OFL (Santiago Orozco).
- **Big Shoulders Display** (numerals only): Chicago's municipal typeface, condensed and
  civic. Countdown, dates (07 · 17 · 27), section numerals, table numbers; always with
  `tnum`/`lnum`. OFL (Patric King). Note: Google Fonts still serves the family as
  "Big Shoulders Display" (v24) but the catalog now lists the merged variable family
  "Big Shoulders" with an optical-size axis; either is fine, set opsz 72 when self-hosting.
- Scale: display-xl 4.25rem, display-lg 2.75rem, h1 2rem, h2 1.5rem, h3 1.125rem (Josefin
  600), body-lg 1.3125rem, body-md 1.125rem, body-sm 1.0625rem, label-caps 0.8125rem,
  numeral 3.5rem, numeral-xl 6rem. Hierarchy comes from size, tracking, and ornament,
  never from bolding Cinzel.
- Countdown specimen on the board reads 315: the days from the board date to July 17,
  2027, computed, not invented.

### Pairings compared (ui-ux-pro-max searches: "art deco luxury heritage hotel" and "elegant wedding classic serif geometric", typography domain; plus a --design-system run at variance 2 / motion 3 / density 2)

| Pairing | Source | Verdict |
|---|---|---|
| Cinzel + Josefin Sans + Big Shoulders Display | Brief; ui-ux-pro-max lists Cinzel + Josefin Sans as its "Real Estate Luxury" pairing (architecture, interiors) | Chosen. Cinzel is a Roman capital drawn for screens, the nearest thing to letters cut in the CAA limestone. Josefin is a 1920s geometric with signboard proportions and seven weights, so labels and body come from one family. Big Shoulders is Chicago's municipal face and gives every number a civic voice. Each family has exactly one job. |
| Poiret One + Didact Gothic | ui-ux-pro-max "Art Deco" pairing | Rejected. Poiret One is one hairline weight and reads as Gatsby costume; it fails below 40px and cannot carry a heading on a phone. Didact Gothic is a neutral schoolbook sans with no relationship to the building. |
| Bodoni Moda + Jost | ui-ux-pro-max "Luxury Minimalist" | Rejected. A didone belongs to a fashion house, not an 1893 athletic club; Jost is a Futura revival that reads Bauhaus rather than Chicago, and the pair still needs a third face for numerals. |
| Marcellus + Tenor Sans | Proposed alternative (both OFL, same designer lineage as Cinzel's Trajan tradition) | Near miss. Marcellus is a single-weight Trajan-style capital, so hierarchy would depend on size alone; Tenor Sans is handsome but single-weight too and has no numeral character. Both would need Big Shoulders anyway, which makes Cinzel + Josefin the stronger two. |
| Playfair Display + Inter; Great Vibes + Cormorant Infant | ui-ux-pro-max "Classic Elegant" and "Wedding/Romance" (top results for "wedding") | Excluded by rule: Playfair, Inter, Cormorant, and script faces are anti-references in the brief and stylelint. |

The `--design-system` run returned "Hero + Testimonials + CTA", a pink "romantic" palette,
and Great Vibes + Cormorant Infant: a useful negative result. It is exactly the wedding
template the brief rejects, and it confirms the catalogue has no Deco-for-2027 answer, so
the brief's pairing stands.

## 4. Layout, spacing, shapes

- One vertical axis per page; headings, numerals, ornament, and the RSVP action sit on it;
  body copy and forms sit left-aligned inside a centered 42rem column.
- 12 columns, max 1200px, gutter 24px, margins 20px (phone) / 64px (desktop). Section
  rhythm 96px desktop / 64px mobile. Spacing scale 4/8/16/24/40/64/96/160 plus `step`
  = 24px, the module every stepped corner is cut from.
- Navigation is a frieze (monogram centered, three links each side) on desktop and a
  fixed bottom elevator panel (Weekend, Travel, RSVP, Ask us) on phones.
- Radius 0 everywhere except inputs (2px). Octagons for plaques, stepped corners for
  frames and featured cards, chevrons for rules. No pills.
- Depth is engraved, not lifted: hairlines, double hairlines, inset frames, tonal steps.
  The only shadow is under the mobile elevator panel.

## 5. Components (why they look this way)

- **Buttons**: rectangles with a 1px inset hairline (an engraved edge, not elevation).
  Primary is Lacquer Ink; accent is Bronze and reserved for RSVP; ghost is marble with an
  ink border for secondary actions and explicit external handoffs ("Continue securely
  with Uber"). Hover swaps ink and bronze; focus is a 2px Lake Blue ring.
- **Inputs**: label always visible above in label-caps; 18px text so iOS does not zoom;
  focus tints the field lake wash; errors are inline text in oxblood, never color alone.
- **Sections**: marble by default; creme for travel and stay; lake wash for Your Weekend
  and the RSVP confirmation; Lacquer Ink with Gold Leaf headings for evening moments.
- **Countdown**: Big Shoulders numerals with tabular figures, unit label in muted caps,
  digits crossfade.
- **Numeral plaque**: 56px octagon, gold wash fill, gold hairline, ink numeral. Only for
  real sequences.
- **Dividers**: chevron rule (gold) between major sections; quiet hairline (outline)
  inside lists; 3px gold stepped frame around photographs.

## 6. Motion tokens

Durations 160 / 280 / 700 / 1100ms. Easings: engrave `cubic-bezier(0.2, 0, 0, 1)`,
doors `cubic-bezier(0.65, 0, 0.35, 1)`, settle `cubic-bezier(0.33, 1, 0.68, 1)`.
Choreographies: curtain rise (home, once per session), elevator doors (route
transitions, degrades to crossfade), engraved reveal (section entrance, once).
Reduced motion: everything becomes a 120ms fade. Never: bounce, elastic, parallax,
scroll-jacking, per-card hover theatre.

## 7. Ornament inventory (generated, license-free)

- `sunburst-hero.svg` (1440×720): Gold Art Deco sunburst: hairline rays fanning upward from a stepped half-sun at the bottom centre, on a transparent ground.
- `chevron-divider.svg` (1200×40): Gold hairline section divider with a centred cluster of three nested chevrons and small diamonds.
- `stepped-frame.svg` (800×1000): Gold Art Deco photo frame with stepped corners: a heavy outer line and a hairline inner line, open in the middle for a photograph.
- `corner-bracket.svg` (160×160): Gold stepped corner bracket for the top-left of a framed block.
- `monogram-frame.svg` (600×600): Monogram plaque: the letters S and T joined by an ampersand inside a double gold octagon, with the date 07 · 17 · 27 beneath.
- `marble-texture.svg` (800×800): Pale marble texture: warm white ground with faint diagonal grey veins.
- `numeral-badge-01.svg` (200×200): Octagonal gold-edged plaque with the section number 01.
- `numeral-badge-02.svg` (200×200): Octagonal gold-edged plaque with the section number 02.
- `numeral-badge-03.svg` (200×200): Octagonal gold-edged plaque with the section number 03.
- `numeral-badge-04.svg` (200×200): Octagonal gold-edged plaque with the section number 04.
- `numeral-badge-05.svg` (200×200): Octagonal gold-edged plaque with the section number 05.

Rules: sunburst once per site (home hero); chevron rule between major sections; stepped
frame for photographs only; corner brackets for quotes and "Sara remembers / Tyler
remembers"; monogram plaque in the nav, on the gate, on the RSVP confirmation; marble
ground at ≤ 6% vein opacity and off in print.

## 8. References (borrow / avoid)

### The Wam Bam Club (Awwwards Honorable Mention, 2014, Absolute)
https://www.awwwards.com/sites/the-wam-bam-club

A supper club housed in the Bloomsbury Ballroom, a 1920s Art Deco venue in London.

- Borrow: Let a real Deco room be the picture; keep the type small, disciplined, and off the photograph.
- Avoid: Nightlife energy and jQuery-era parallax; the wedding site is calm and its guests are three generations.

### Varani Gin (Awwwards Nominee, September 2025, Matteo De Filippis)
https://www.awwwards.com/sites/varani-gin

An interactive gin story mixing Art Nouveau and 1920s Gatsby cues, with a custom nav bar and a long orchestrated scroll.

- Borrow: One orchestrated storytelling sequence per page and a nav that is clearly its own object.
- Avoid: The glassmorphism cart, the 3D bottle, and the botanical flourishes (those belong to Conservatory, not here).

### Baz Luhrmann's Gatsby Journal (Awwwards Nominee)
https://www.awwwards.com/sites/baz-luhrmann-s-gatsby-journal

A journal of the film's creative process; page-turning archive framing. (Entry page returned 502 at fetch time; noted from the Awwwards listing only.)

- Borrow: The archive-as-journal frame fits "the permanent archive of a shared weekend" from the brief.
- Avoid: Film-marketing spectacle and Gatsby costume; our Deco is a civic building, not a party theme.

### Awwwards art-deco tag page (fetched 2026-09-05)
https://www.awwwards.com/websites/art-deco/

The tag page returned the general nominee feed (Santioni Spirits, Théâtre Rude Ingénierie, Deep White Gallery were checked and carry no Art Deco tag), so only the three entries above could be verified as Deco-adjacent.

- Borrow: From the general feed: the current bar for transitions is one confident device per site, not many.
- Avoid: Treating the feed as a Deco canon; it is not.

### Chicago Athletic Association (from the brief, CAA kit)
https://www.chicagoathletichotel.com/

Built 1893 for the private club; Henry Ives Cobb, facade by Louis Christian Mullgardt; Venetian Gothic after the Doge's Palace; opened amid the World's Columbian Exposition. White City Ballroom: Carrara marble floor, three 19th-century fireplaces, 167 restored illuminated ceiling embellishments. Madison Ballroom: walnut parquet, crystal chandeliers. Stagg Court: the original gymnasium with an elevated running track. The Tank: the former pool with original tile and marble pillars.

- Borrow: Marble as the ground, gold as the light on it, arched and stepped geometry as frames, numbered rooms as a sequence to walk through.
- Avoid: The venue's own photography (copyrighted; never reuse), the "Venetian Gothic" ornament vocabulary (that is 1893; our ornament is 1920s), and building around White City before the ceremony room is confirmed.

### Chicago Deco landmarks (public architectural references; verify dates before publishing)
https://www.architecture.org/

Carbide and Carbon Building (1929, Burnham Brothers: dark green terracotta with gold leaf), Chicago Board of Trade (1930, Holabird and Root), Palmolive Building (1929). Stepped setbacks, vertical emphasis, gold leaf on a dark ground.

- Borrow: The stepped setback as a frame profile; gold leaf on lacquer for the evening sections; verticality on the axis.
- Avoid: Dark-first pages. Our ground is white marble; the dark moments are the exception.

### 1920s Chicago typography
https://fonts.google.com/specimen/Big+Shoulders+Display

Roman capitals on civic stone (the Cinzel lineage), geometric sans on signboards (the Josefin lineage; Futura and Kabel are 1927), and condensed grotesques on industrial and stockyard signage (the Big Shoulders lineage, named for Sandburg's "City of the Big Shoulders").

- Borrow: One face per lineage, each with one job; wide tracking on capitals; numerals with civic weight.
- Avoid: Decorative Deco display faces with inline or double-line strokes (Limelight, Poiret One); they date instantly and fail at small sizes.

## 9. Anti-references

- Centered-script-on-blush templates and "Mr. & Mrs." clip art
- Watercolor floral corners (Conservatory earns foliage; Gilded Hour never paints it)
- SaaS hero + three cards, testimonial rows, bento grids
- Glassmorphism, purple or indigo gradients, glows, neon
- Gatsby-party costume: feathers, champagne towers, black-and-gold everything
- Gold text on white, gold buttons, gold icons that carry meaning
- Bouncy or elastic motion; scroll-jacking; parallax
- Inter, Roboto, Arial, Helvetica, Space Grotesk, Fraunces, Playfair, Cormorant, Instrument Serif, any script face
- The venue brochure: its photographs, its "timeless elegance" copy, its room hierarchy

## 10. How this differs from Conservatory

| Axis | Gilded Hour | Conservatory |
|---|---|---|
| Ground | White marble; ornament is drawn on it | Creme with sky-blue washes; ornament grows across it |
| Layout logic | One centered axis, mirrored margins, monumental plinths | Organic asymmetry, offset images, hanging captions |
| Navigation | Frieze: monogram centered, three links each side; fixed bottom elevator panel on phones | Botanical index: a hanging list with leaf marks; drawer on phones |
| Ornament | Sunburst, chevron rule, stepped frame, corner brackets, octagonal plaques | Botanical line-art borders, pressed-flower cards |
| Rhythm | Numbered acts that open identically; chevron rules between them | Irregular spacing, leaves settling, soft parallax |
| Type | Cinzel / Josefin Sans / Big Shoulders Display | Gloock / Spectral / Cardo italic accents |
| Motion | Curtain rise, elevator doors, engraved reveal; one per page | Leaves settling, soft parallax; continuous but quiet |
| Photographs | Inside stepped gold frames on the axis | Pressed into cards at an angle, captions hanging |
| Gold | Leaf for lines, bronze for words | A warm highlight inside foliage, rarely structural |

## 11. Self-score (Awwwards axes)

| Axis | Score | Why |
|---|---|---|
| Design (40%) | 8 / 10 | Hierarchy through size, axis, and ornament; tokens locked; no slop tells. Loses points until real photography exists. |
| Usability (30%) | 8 / 10 | Reads on a phone, tables scroll, contrast computed, labels visible. The board itself has no forms to test. |
| Creativity (20%) | 7 / 10 | The two-golds rule, the elevator panel, and the numbered acts are the ideas that are theirs; the sunburst is expected. |
| Content (10%) | 8 / 10 | Facts only from the brief; unknowns marked TODO(Tyler & Sara); no invented metrics. |

Hallmark pre-emit critique: P4 H4 E4 S5 R4 V3. Variety is the honest weak axis because
symmetry is the brief; distinctiveness comes from the two-golds rule, the elevator
panel, and the numbered acts.

## 12. Open questions

- Which room hosts the ceremony, cocktail hour, and reception (the wireframes say "room: TODO"). Do not build around White City until confirmed.
- RSVP deadline and the lifecycle dates (save-the-date, invitations open).
- Font packaging: Google Fonts still serves "Big Shoulders Display" (v24) but the catalog now lists the merged variable family "Big Shoulders" with an optical-size axis. Self-host one, set opsz to 72 for numerals, and keep the DESIGN.md family name in sync.
- Whether the elevator-doors route transition (View Transitions API) is acceptable on hotel Wi-Fi; it must degrade to a crossfade.
- Whether the mobile elevator panel should carry Weekend / Travel / RSVP / Ask Us in every lifecycle state, or swap RSVP for Photos after the wedding.
- Whether the couple wants the monogram to read "S & T" or "Sara + Tyler" (the brief writes "Sara + Tyler"; the plaque uses an ampersand for the lockup).
