# PR 11 — Media pipeline: uploads, galleries, moderation, in both designs

Level **10** of 17. Base: `main` (level 09 merged as `8b8e06a`). 90 files from swarm H, plus the
integration and design work below.

| Field | Value |
|---|---|
| Branch | `claude/wedding-10-media` |
| Base | `main` |
| Reviewer | integrator (self) |
| Date | 2026-09-07 |
| Commands run | `npm run verify`, both CI Playwright arrangements, `impeccable detect` on four surfaces × two designs, axe across 16 route/design/viewport combinations, a JavaScript-disabled render check |

## 1. Hostile-reviewer pass

*What is the worst thing a reviewer could say about this diff?*

**"You keep finding the same four defects, level after level, and you keep finding them by hand."**
Fair, and it is why this level's plan put the checklist in writing before the branch was touched.
Levels 08, 09 and 10 have now each shipped: a swarm-local principal resolver installed as a side
effect of a production barrel; ownership columns as bare `text` where a foreign key belongs; a
capability requiring an entitlement the default test guest does not hold; and a spec that cannot
pass in the arrangement CI runs it in. Four for four, three levels running. The checklist found all
four here in about twenty minutes of reading, before a single test was run — which is the argument
for it.

**"`/photos` shipped rendering in Times New Roman."** It would have. Measured, with JavaScript
disabled, on the built branch before the design pass:

| | `/photos` (before) | `/gifts` (level 09, for comparison) |
|---|---|---|
| themed ancestor | **none** | yes |
| h1 face | **Times New Roman** | Cinzel / Gloock |
| nav | **none** | present |
| design switcher | **none** | present |

With JavaScript *on* it was no better in kind — the h1 rendered in the **text** face at one fixed
38.25px in both designs, because `MediaPage` was rendered bare and nothing above it carried
`[data-theme]` for `media.css`'s `var(--color-*)` to resolve against. That is the level-04 defect
the guest layout had and the level-09 position `/gifts` was in. Both gallery pages now go through
the recipe seam.

**"You changed a security-relevant read path on a hunch."** No — on a measurement, and with a
negative control. `list_gallery` filtered the *collection's* visibility and then listed every
published asset in it, while `media_assets.visibility` is nullable, documented as *"Overrides the
collection's visibility when set"*, and honoured by `canViewPublishedAsset`. The new test sets the
column directly and **fails without the fix** (`expected [ '01M1WY…' ] to deeply equal []`). It is
latent today because nothing writes the column — which is the reason to close it now rather than
later, since level 11's media AI and level 14's admin ops are the features that will.

**"Two of your test fixes are just loosened assertions."** They are the opposite, and both were
measured before and after. The uploader test asserted `a.assetId === 'ASSET_U1'` when `pump()` runs
two jobs concurrently and each calls `create` separately, so which file the server hands `U1` to is
a race: **1 failure in 10 runs** before, **0 in 25** after, and the assertion is now that a job holds
the asset minted for *its own* session — strictly stronger, because it also checks the two sessions
differ. The admin-queue assertion used `getByRole('status')` when approving the last item makes the
emptied queue render a second `role="status"`; it now names the result note.

## 2. Authorization table

| Route / action | Capability + kind | Server-side check | Test | Result |
|---|---|---|---|---|
| `/photos` | `list_gallery` (read, anonymous) | `canViewCollection` per album; **new:** `canViewPublishedAsset` per asset | `media.test.ts` "moderation publishes into the gallery with ACL" + the new per-asset override case | fixed this PR |
| `/photos/[collection]` | same | a collection the caller may not see 404s rather than revealing it exists | same | unchanged |
| `/media/upload`, `/media/mine` | `create_upload`, `complete_upload`, `resume_upload`, `abort_upload`, `delete_my_upload`, `list_my_uploads` (guest) | `upload_media`; `ownsUpload` for resume/abort/delete | `tests/security/uploads.spec.ts` | unchanged |
| `/admin/media/*` | 5 capabilities (admin) | all behind `admin_media` | `resolver.test.ts` count 48 → 53 | unchanged |

**The anonymous surface, checked rather than assumed.** `list_gallery` and `get_media_item` join the
anonymous list because `/photos` is public. What makes that safe is the ACL, not the `auth` line:
`canViewVisibility` returns true for an anonymous principal only when the effective visibility is
`public`; `guests`, `household` and `private` each require `kind === 'guest'`; and
`canViewPublishedAsset` demands `status === 'published'` first.

**Agent exposure.** All five mutating upload capabilities are `ui: true, ai: false, webmcp: false` —
swarm H's own choice, and the right line: an upload is the one thing on this site a guest cannot
recreate. `delete_my_upload` additionally carries `confirmation: 'inline'`. Only the three reads
reach an assistant.

## 3. Secrets and PII grep

```
$ grep -rnE "(sk_|pk_live|BEGIN (RSA|EC) PRIVATE|[0-9]{3}-[0-9]{3}-[0-9]{4})" src tests docs
… only `ask_us` matching `sk_`, as at every previous level
```

- [x] No guest names, emails, addresses or phone numbers in the repo
- [x] No provider keys in client bundles — the storage signer is server-only
- [x] **EXIF/GPS stripped on every served derivative** — asserted on real bytes, not on the schema
      comment that claims it: the e2e journey fetches the served thumbnail and checks the body does
      not contain `Exif`, and the video case checks location atoms are gone from the served copy

## 4. Tests

| Area | Covered by | Not covered — why |
|---|---|---|
| Unit | `uploader.test.ts` (single PUT, multipart, dedupe, rejection, bounded retry, resume, cancel), `state-acl.test.ts`, `limits-keys-checksum.test.ts` | — |
| Integration | `media.test.ts` — 11 cases on PGlite + local-fs: signed tickets, complete/derive, expired URLs, polyglot and renamed-archive rejection, oversize, duplicates, moderation + ACL, **per-asset visibility override**, video atoms, deletion with archive manifest, metrics and sweep | — |
| E2E | `media-upload.spec.ts` — the phone journey with a network interruption, resume, admin bulk approve, gallery, lightbox, focus return | Desktop upload: the journey is deliberately phone-only (guests scan a QR at the wedding) |
| Security | `tests/security/uploads.spec.ts` | — |
| Axe | `/photos` in the public route list; all four media surfaces × 2 designs × 390/1440 measured directly (**0 blocking**) | `/media/upload` and `/media/mine` are **not** in the public axe list: they are guest-gated, so auditing them there would audit the sign-in page under their name — third time this has come up |

**Negative controls.** The gallery-visibility test was run against the unfixed capability and seen to
fail. The uploader fix was measured 1/10 → 0/25.

## 5. Threat-model items touched

- [x] **0005 media storage** — originals private, only derivatives served, short-lived signed URLs,
      `content-security-policy: sandbox` on served bytes, EXIF/GPS absent (asserted on bytes).
- [x] **0002 capabilities** — the gallery read now applies the per-asset ACL it already had.
- [x] **Test-only authority** — the fourth swarm-local injector deleted; one resolver, one gate test.
- [ ] 0001 identity, 0003 AI grounding, 0006 biometrics — untouched (biometrics is level 11).

## 6. Design verdict

No independent `design-reviewer` round has run on this level yet — the last two found real blockers,
so one should, and this is the honest statement of where that stands rather than a claim of a clean
review. What has been measured directly:

| Surface | Gilded Hour | Conservatory |
|---|---|---|
| h1 face / scale | Cinzel 34 → 46.75px, uppercase, tracked | Gloock 38.25 → 51px, sentence case |
| themed with JS **off** | yes | yes |
| nav + switcher | yes | yes |
| `impeccable detect` | **0 findings** | **0 findings** |
| axe (390 + 1440) | **0 blocking** | **0 blocking** |
| horizontal overflow | none | none |

Fixed in the design pass, each measured:

1. Both gallery pages onto the recipe seam, so they render inside the design's Shell — server-side,
   which is what fixes the JavaScript-disabled case.
2. `media.css` headings read the `--type-*` role tokens both designs publish, with the same clamp
   and the same per-design case/tracking tokens the guest kit uses. They were a literal scale with
   no family, so they inherited the body face.
3. Secondary copy raised from `0.9375rem` (15.94px) to `max(17px, 0.9375rem)` — the site's floor,
   set because grandparents are a primary audience, and the same `max()` `.hint` has used since 09.
4. `.media-eyebrow` moved off `--color-tertiary`: Conservatory's gold `#d4b24a` on its `#f4eedf`
   creme measured **1.76:1**, an axe serious violation on both guest media pages. Gilded Hour's
   tertiary is dark enough to pass, which is why it showed in only one design — the same shape as
   level 09's 4.12:1 hint colour.
5. The `60ch` lede cap replaced with the shared rem measure; `ch` is face-relative and was the trap
   level 09 measured at 92 characters against a 65ch cap.

## 7. Accessibility and performance

- **axe 0 blocking violations across 16 runs** (4 routes × 2 designs × 390/1440).
- **No horizontal overflow** anywhere; **no text under 17px** except the uppercase micro-label.
- Lightbox: focus returns to the invoking tile on close (asserted in the journey).
- Thumbnails are lazy, signed, and served with `content-security-policy: sandbox`.

## 8. Docs and ADRs

- ADRs: none added. ADR-0005's guarantees are the ones the tests now assert on real bytes.
- `docs/ops/environment.md` and `.env.example` gain the media variables; H's conflict side also
  narrowed the level-08 `FLIGHTS_PROVIDER`/`HOTELS_PROVIDER` enums and dropped the Skyscanner key,
  so ours won there.

## 9. TODO inventory

12 markers in `src`, none new to a guest surface — the only guest-adjacent one is on an admin metrics
screen, where an author is meant to see it. The level-09 sweep convention (curl every route in both
designs, grep the rendered HTML *and* the RSC payload) is re-run below.

## 10. Verdict

**READY, pending the design review.**

The integration is complete and every gate is green: 346 unit and UI, 152 integration, 195
production Playwright, 112 test-server Playwright, detector 0 on four surfaces in both designs, axe
0 across sixteen combinations. Four recurring defect classes were caught by the checklist before any
test ran, and two genuine bugs — a latent gallery ACL gap and a concurrency race in a test — were
each closed with a control proving the fix.

What is outstanding is an **independent design review**. On both levels it has run, it found real
blockers, including one honesty defect I had introduced myself; the measurements above are mine, and
mine have been wrong before. That round comes before merge.

Carried forward, unchanged and named again so it is not mistaken for new: the guest tree onto the
per-design theme Shell and Gilded Hour's ~85-character prose measure (both level 16), and the 13.8px
`--type-label-caps-size`, which is a DESIGN.md type-scale question rather than any one level's
regression.
