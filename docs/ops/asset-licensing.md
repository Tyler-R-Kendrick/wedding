# Placeholder imagery and asset licensing

| Field | Value |
|---|---|
| Status | Accepted (operational policy) |
| Date | 2026-09-05 |
| Owners | Tyler & Sara (rights holders' contacts); the agent or person who adds any image |
| Related | `docs/design/brief.md` §2 (CAA facts) and §7 (rights and legal gates); `CLAUDE.md` "Rules for UI work"; `public/assets/ATTRIBUTIONS.md`; `public/assets/attributions.json` |

The site will eventually be full of the couple's own photographs. Until those
arrive, every image on a page is a **placeholder**, and every placeholder must
come from one of the three sources below, in this order of preference. Nothing
else is allowed in the repository, in a comp, or in a screenshot that leaves
the repository.

## 1. The three permitted sources

### 1a. Procedural art generated in-repo (preferred)

`scripts/art/<theme>.mjs` modules describe SVG art in code;
`node scripts/generate-art.mjs [theme]` renders them to
`public/assets/art/<theme>/*.svg` plus a `manifest.json` whose `license`
field reads "Generated in-repo (scripts/art); no third-party rights".
Sunbursts, chevrons, stepped frames, botanical line borders, pressed-leaf
silhouettes, marble and moss textures all belong here.

- Rights: none to clear. The code is ours; the output is ours.
- Rules: no tracing of a photograph, logo, typeface glyph, or another
  designer's illustration. Motifs are interpretations of the building and the
  couple's tastes (brief §4), never copies of the CAA/Hyatt brand marks.
- Ledger: not required (the manifest is the record).

### 1b. Wikimedia Commons and Openverse, with the ledger

For photographs of real things (the building, Michigan Avenue, historical
engravings, botanical specimens) we use openly licensed files fetched **only**
through the two scripts, which refuse anything outside the license allowlist
and write the ledger for everything that lands:

```bash
export -n NODE_OPTIONS
NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs                      # the four vetted CAA files (default list)
NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs --dry-run            # resolve + license-check, write nothing
NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs "File:Some file.jpg" --use "Explore CAA — lobby detail"
NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs --list-only          # candidates in the CAA building category (never downloads)
NODE_USE_ENV_PROXY=1 node scripts/fetch-openverse.mjs "fern pressed specimen" --license cc0,pdm
NODE_USE_ENV_PROXY=1 node scripts/fetch-openverse.mjs --download <identifier> --use "Conservatory — pressed-fern card"
node scripts/fetch-commons.mjs --check                                   # ledger gate (no network); see §5
```

- Files land in `public/assets/commons/<slug>.<ext>` (Commons) or
  `public/assets/commons/openverse-<identifier>.<ext>` (Openverse).
- `--out <dir>` changes the directory; the ledger path does not move.
- Commons renders thumbnails only at fixed bucket widths (1920 px verified on
  2026-09-05; 2000 and 2560 answer HTTP 400). The script asks for ≤ 2000 px,
  falls back through the buckets, and records the pixel size it actually
  received. Originals wider than that are never committed.
- Openverse is searched with `license=cc0,pdm,by` at most; `--download`
  accepts cc0/pdm by default and needs `--allow-by` for CC BY / CC BY-SA.
- The proxy: outbound HTTPS goes through the sandbox proxy, and Node's
  `fetch` only honours `HTTPS_PROXY` when `NODE_USE_ENV_PROXY=1` is set. If a
  host answers 403/407 from the proxy, report it; do not route around it.
- Rate limits: the Commons API throttles bursts ("You are making too many
  requests"); the script spaces calls ≥ 1 s apart and backs off 5/15/30/60 s.
  Openverse allows 20 requests/min and 200/day anonymously (per IP); set
  `OPENVERSE_CLIENT_ID` and `OPENVERSE_CLIENT_SECRET` in `.env` for
  client-credentials auth (the token is requested per run and never stored).

### 1c. Generated imagery (fal.ai, Higgsfield) — mood and placeholders only

`node scripts/fal-generate.mjs "<prompt>"` (needs `FAL_KEY`) and the
Higgsfield skills produce concept imagery for mood boards, comps and
temporary page fills while the real photographs are pending.

- Output goes to `.impeccable/review/` (git-ignored) or, when a page needs a
  committed placeholder, to `public/assets/generated/` with a sibling
  `generated.json` listing model, prompt, date and the page it stands in for.
- **Never** shipped as a "photo of the couple", of a guest, of the wedding
  party, or of a vendor's work. **Never** presented as a real photograph of
  the venue: generated interiors of "the White City Ballroom" are fiction and
  must be captioned as concept art if they appear at all.
- No likeness generation: no Soul/identity model of Sara, Tyler, family or
  guests without their explicit consent (brief §7; Illinois BIPA), and never
  from the professional photographers' files (see §4).
- Every generated placeholder is tracked in `docs/content/backlog.md` as a
  `TODO(Tyler & Sara)` so it is replaced before launch.

## 2. License allowlist

| License | Accepted | What we owe | Where recorded |
|---|---|---|---|
| CC0 1.0 (public-domain dedication) | yes | Nothing. We credit anyway. | ledger + `ATTRIBUTIONS.md` |
| Public domain / Public Domain Mark (e.g. `PD-US-expired`, 1897 engravings) | yes | Nothing. We credit the source and keep the provenance link. | ledger + `ATTRIBUTIONS.md` |
| CC BY 2.0 / 3.0 / 4.0 | yes | Attribution: title, creator (linked), source (linked), license name (linked), and a note of any changes (crop, tint, resize). | ledger `attribution` field, shown wherever the image appears, plus the credits page |
| CC BY-SA 2.0 / 3.0 / 4.0 | yes | Everything CC BY requires, **and** any derivative we publish (crop, duotone, composite, animation frame) must carry the same CC BY-SA license and version, linked. Keep such derivatives out of themed composites you would rather keep proprietary. | as above; `ATTRIBUTIONS.md` marks the share-alike group |
| CC BY-NC, CC BY-ND, CC BY-NC-SA, CC BY-NC-ND | **no** | — | refused by `classifyLicense` |
| GFDL-only, "fair use", "copyrighted free use", "attribution" without a version, untagged files | **no** | — | refused |
| Anything from a venue or vendor site (see §3) | **no** | — | never fetched |

A file that is multi-licensed (Commons often lists GFDL + CC BY-SA 4.0/3.0/…)
is recorded under the CC license the API reports as primary; we rely on that
CC license only. If the license on the source page differs from what was
expected, the actual license wins and the ledger says so.

## 3. Forbidden sources

Never download, screenshot, trace, or "reference" imagery from:

- `hyatt.com`, `chicagoathletichotel.com`, `cindysrooftop.com`, any Hyatt /
  CAA social account, the CAA wedding kit PDF, or any venue marketing page —
  copyrighted, and the brief (§2, §7) says so explicitly.
- Vendor sites and deliverable previews: Bustle & Lace (planner materials
  are the planner's IP), Brooke Alaina Photography's portfolio, Oakhouse
  Visuals, Rare Bird Beauties, florists, caterers.
- Google Images, Bing Images, Pinterest, Instagram, Unsplash-style sites
  outside the allowlist, stock sites, Are.na boards.
- Awwwards, Dribbble, Behance or any award-site screenshots; the study list
  in `wedding-site-standards` is for reading, not for lifting pixels.
- Other couples' wedding sites and photographers' blogs.

If a comp or mood board needs "something like the Hyatt photo", generate it
(§1c) or draw it (§1a) — and label it.

## 4. Replacing placeholders with the couple's photographs

Two classes of real photographs will arrive:

1. **Engagement and personal photos** the couple took or own outright.
2. **Professional deliverables**: Brooke Alaina Photography (two
   photographers, photojournalistic coverage from getting-ready through six
   songs of open dancing) and Oakhouse Visuals video. Per the contracts, the
   photographer retains copyright; the couple has **personal, non-commercial
   online display rights**. Third-party AI or biometric processing of these
   files requires the photographer's **written confirmation first**
   (`PRO_MEDIA_AI_PROCESSING` flag stays OFF until then), and any face
   matching stays behind `BIOMETRICS_ENABLED=false` with the BIPA consent
   ledger (brief §7).

Procedure when a batch arrives:

1. Put originals outside the repo (they are large and personal). Export
   web-size renditions locally with deterministic tooling (Astro/Sharp
   resize, format conversion, EXIF/GPS stripping). Local resizing is not "AI
   processing"; upscalers, generative fill, background removal, smart-crop
   services and face-detection are, and need the written confirmation above.
2. Commit renditions to `public/assets/photos/<event-or-place>/` with a
   `photos.json` manifest: file, photographer, date, people shown (for alt
   text and consent tracking, not for face matching), `credit` line and
   `consent` (who agreed to be shown). Credit professional work as
   `Photo: Brooke Alaina Photography` / `Video: Oakhouse Visuals` on the
   photos page and in image captions where the design allows.
3. Swap the placeholder reference in the page for the real file, then delete
   the placeholder from `public/assets/commons/` **and** remove its ledger
   entry by re-running the script (or hand-editing `attributions.json` and
   regenerating `ATTRIBUTIONS.md`). Run `node scripts/fetch-commons.mjs
   --check` afterwards.
4. Close the matching `TODO(Tyler & Sara)` in `docs/content/backlog.md`.
5. Photos of guests: only after the guest has agreed (RSVP consent field or
   direct message); children only with a parent's agreement. Keep a note in
   `photos.json`'s `consent` field.

Never upload professional deliverables to fal.ai, Higgsfield, Stitch, or any
other third-party generator, even "just to test", until the written
confirmation exists in the repo's private records.

## 5. How the ledger is enforced

`public/assets/attributions.json` is the machine-readable ledger;
`public/assets/ATTRIBUTIONS.md` is generated from it and is what the site's
credits page should mirror. Each entry records: `title`, `sourcePageUrl`,
`sourceFileUrl`, `downloadUrl`, `author` (+ `authorUrl`), `license`
(`shortName`, `url`, `attributionRequired`, `shareAlike`), `attribution`
(the ready-to-print credit line), `retrievedAt`, `sha256`, `bytes`,
`width`×`height`, `originalWidth`×`originalHeight` (+ Commons `sha1`),
`intendedUse`, and `downloaded`. Human-edited `intendedUse` and `notes`
survive re-runs.

`node scripts/fetch-commons.mjs --check` (no network) exits non-zero when:

- a file in `public/assets/commons/` has no ledger entry;
- a ledger entry's `sha256` does not match the bytes on disk (edited images
  must be re-fetched or recorded as derivatives);
- the recorded license is outside the allowlist, or lacks a URL;
- any required field is empty, or a CC BY / BY-SA entry has no attribution;
- `ATTRIBUTIONS.md` is out of date relative to the JSON.

CI: wire `node scripts/fetch-commons.mjs --check` into `npm run quality`
(package.json is not edited by the assets agent; the owner of `quality`
adds it). Until then, run it before every PR that touches `public/assets/`.

## 6. Commands, in one place

```bash
export -n NODE_OPTIONS                                                    # always, in this sandbox
node scripts/generate-art.mjs                                             # procedural SVG art → public/assets/art/
NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs                       # default CAA set → public/assets/commons/ + ledger
NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs --dry-run             # check without writing
NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs "File:X.jpg" --use "…" --width 1920 --out public/assets/commons
NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs --list-only           # category candidates, no download
NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs --list-only --category "Category:Michigan Avenue (Chicago)"
NODE_USE_ENV_PROXY=1 node scripts/fetch-openverse.mjs "art deco sunburst brass" --license cc0,pdm --page-size 10
NODE_USE_ENV_PROXY=1 node scripts/fetch-openverse.mjs --download <identifier> [--allow-by] --use "…"
node scripts/fetch-commons.mjs --check                                    # ledger gate
FAL_KEY=… node scripts/fal-generate.mjs "<prompt>" --out .impeccable/review/x.png   # mood only
```
