# ADR-0005: Media storage model — private originals, served derivatives

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-09-05 |
| Deciders | Tyler (integrator), design/SDLC swarm |
| Related | ADR-0006, ADR-0008, ADR-0011, `docs/design/brief.md` §2 (photo/video contracts), §7 |

## Context

Three media sources with different rights: the couple's own photos;
professional photography (Brooke Alaina Photography — photographer retains
copyright, couple has personal non-commercial online display rights) and
video (Oakhouse Visuals — edited ceremony, first dances, toasts, raw
footage); and guest uploads during and after the weekend. Guests' phones
embed GPS and device data. The archive must outlive the wedding (brief §1:
"the permanent archive of a shared weekend"). Third-party AI or biometric
processing of professional media needs written confirmation
(`PRO_MEDIA_AI_PROCESSING=false`).

## Decision

1. **Storage is S3-compatible and private by default** (local filesystem in
   dev, Cloudflare R2 in prod — ADR-0008). No public bucket. Every read is a
   **signed URL** scoped to a derivative, short-lived, issued by a `read`
   capability (ADR-0002) after entitlement.
2. **Prefix layout:**

   | Prefix | Contents | Who can read |
   |---|---|---|
   | `quarantine/<uploadId>` | raw uploads before validation | nobody (system only) |
   | `originals/guest/<guestId>/<mediaId>` | validated guest originals | uploader, admin |
   | `originals/professional/<vendor>/<mediaId>` | delivered professional files | admin only |
   | `derivatives/thumb/<mediaId>` | ≤ 320 px | entitled guests |
   | `derivatives/gallery/<mediaId>` | ≤ 1600 px | entitled guests |
   | `derivatives/web-full/<mediaId>` | ≤ 2560 px, download-quality | entitled guests |
   | `archive/<year>/…` | cold copy of originals + manifests | admin only |

3. **Derivatives are the only thing ever served.** They are re-encoded
   (AVIF/WebP + JPEG fallback), and **EXIF/GPS/XMP are stripped**; a
   separate `MediaMetadata` row keeps capture time and camera for the
   archive, never location for guest media unless the uploader opts in.
4. **Pipeline:** `quarantine` → validate (type sniffing, size, image
   decode, malware scan hook) → move to `originals/*` (private) →
   generate derivatives → `moderated` (default for guest uploads) →
   `published` after admin or auto-approval rule. Professional media enters
   at `originals/professional` and is published by admin only.
5. Rights flags on every `Media` row: `source` (`couple`, `guest`,
   `professional`), `licenseNote`, `allowDownload`, `allowAiProcessing`
   (always `false` for professional unless the flag and written
   confirmation exist), `visibility` (`private`, `household`, `guests`,
   `public`).
6. Deletion: guest can delete own uploads (originals + derivatives + rows);
   admin deletion is soft for 30 days then hard. Archive keeps a manifest of
   deletions.
7. No third-party image CDN that re-fetches originals; derivatives are
   built in our pipeline.

## Consequences

**Positive.** Nothing leaks by URL guessing; a leaked signed URL expires.
GPS never reaches a guest. Professional rights are honoured by construction.
The archive state is the storage layout itself.

**Negative / costs.** Derivative generation is a job queue with failure
states to design. Signed URLs defeat naive browser caching; use long-lived
derivative keys with short-lived signatures and `Cache-Control: private`.

**Follow-ups.** Upload UI states (quarantine, processing, published).
Moderation queue in admin. Storage cost estimate for ≈142 guests × wedding
weekend.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Public bucket with obscure keys | Keys get shared; GPS leaks; no revocation |
| Shared album on a photo provider | Rights and retention outside our control; no entitlement model |
| Serve originals with on-the-fly transforms | Originals exposed to the transform service; EXIF handling inconsistent |

## Compliance

- Test: uploaded JPEG with GPS → served derivative has no EXIF.
- `grep -rn "originals/" src/app` shows no direct URL construction outside
  the media capability module.
