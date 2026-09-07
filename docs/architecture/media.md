# Media pipeline (Swarm H)

Storage, upload, processing, galleries and moderation for guest photos/videos, the couple's own
photos and the professional deliveries. Decisions: [ADR-0005](../adr/0005-media-storage-model.md)
(private originals, served derivatives), [ADR-0002](../adr/0002-capability-layer.md) (one door),
brief §2.3 and §7 (professional rights, `PRO_MEDIA_AI_PROCESSING` off).

## Layout

| Layer | Path | What lives there |
|---|---|---|
| Pure utilities | `src/lib/media/` | `limits.ts` (allowlist, caps, upload plan), `sniff.ts` (content sniffing + polyglot checks), `mp4.ts` (ISO-BMFF walker, probe, metadata strip, fixture builder), `checksum.ts` (SHA-256, quick fingerprint, dHash), `exif.ts` (capture time/camera; only *whether* GPS existed), `images.ts` (sharp derivatives, HEIC via heic-convert, quality signals), `keys.ts` (the only place storage keys are built) |
| Domain | `src/domain/media/` | `state.ts` (asset state machine), `acl.ts` (visibility), `collections.ts` (albums + chapters), `uploads.ts` (tickets, resume, complete, abort, expiry), `pipeline.ts` (process/derive), `assets.ts` (listing, moderation, deletion, duplicates), `signed.ts` (the only read-URL issuer), `archive.ts` (deletion manifests), `metrics.ts`, `jobs.ts` (handlers) |
| Schema | `src/db/schema/media.ts`, migration `0002_brainy_natasha_romanoff.sql` | `media_collections`, `media_uploads`, `media_assets`, `media_derivatives`, `media_moderation`, `professional_media_rights` |
| Providers | `src/providers/video/` | `types.ts` (delivery + processing seam), `mock.ts` (placeholder poster), `ffmpeg.ts` (posters/probing when a binary exists; reports what the build can do), `cloudflare-stream.ts` (delivery skeleton), `placeholder.ts` (dependency-free PNG) |
| Capabilities | `src/capabilities/media/` | see the table below; `test-principal.ts` is the test-only principal injector |
| Routes | `src/app/api/uploads/[action]` (aliases of the upload capabilities), `src/app/api/uploads/jobs/run` (media cron alias) | thin: every request goes through the capability door |
| UI | `src/components/media/`, `src/app/(guest)/media/{upload,mine}`, `src/app/(public)/photos`, `src/app/(admin)/admin/media/{,duplicates,import,metrics}` | recipe-style components on DESIGN.md tokens only (`media.css`) |

## Storage layout (ADR-0005)

```
quarantine/<uploadId>/original                    raw upload; write-only for guests, read by the process job, deleted after
originals/guest/<guestId>/<assetId>.<ext>         validated guest/couple originals (couple: originals/guest/couple/…)
originals/professional/<vendor>/<assetId>.<ext>   professional deliveries
derivatives/thumb|gallery|web-full/<assetId>.webp|jpg   images (re-encoded, metadata-free)
derivatives/poster/<assetId>.jpg, derivatives/thumb/<assetId>.webp   video posters
derivatives/video-web/<assetId>.mp4|mov           the video with udta/meta/uuid/xtra atoms blanked
archive/<year>/manifests/deletions/<assetId>.json deletion records (admin-only prefix)
```

`src/domain/media/signed.ts` is the only code that signs a read URL and it refuses anything outside
`derivatives/`. `grep -rn "originals/" src/app` stays empty (ADR-0005 compliance check).

## Upload flow

```
create_upload ─▶ ticket (single PUT or N multipart parts, signed, 15-min TTL, content type bound)
   browser PUTs parts directly to storage (XHR progress; 3 automatic attempts per part with backoff)
   interruption ─▶ resume_upload(uploadedParts) re-signs only the missing parts (ETags kept in sessionStorage too)
complete_upload ─▶ multipart assembled, size verified against the declaration, ≤32 MiB objects sniffed at once
   ─▶ media_assets row (quarantined) ─▶ job media.process
media.process   sniff (file-type, independent of name), polyglot/structure checks, kind/family must match the
                declared type, size caps, optional AV hook, SHA-256 (exact-duplicate link), capture metadata,
                move quarantine ─▶ originals/*, status processing ─▶ job media.derive
media.derive    images: sharp → thumb 320 / gallery 1600 / web-full 2560 (WebP + JPEG fallback), auto-orient,
                metadata stripped and verified, dHash, quality signals (numbers only)
                video: MP4/MOV atoms blanked in place (offsets untouched), poster via the video provider
                (real frame with ffmpeg, placeholder otherwise), delivery asset created ─▶ status private
```

Content allowlist: JPEG, PNG, WebP, HEIC/HEIF; MP4, MOV. Rejected: anything file-type cannot
identify (SVG, HTML, scripts), executables/archives/documents, images with an archive/executable/markup
payload appended, and ISO-BMFF files with bytes outside the box structure. Benign trailers (phone
"motion photo" data) are tolerated because originals are never served.

Limits (env, per file): images `MEDIA_MAX_IMAGE_MB` (40), videos `MEDIA_MAX_VIDEO_MB` (512);
parts `MEDIA_PART_SIZE_MB` (8; S3/R2 need ≥ 5) above `MEDIA_MULTIPART_THRESHOLD_MB` (8). Up to 20
files per `create_upload`. Upload URLs expire after 15 minutes; a pending session can be resumed
for 24 h, then `media.sweep` expires it and frees its storage.

## Asset state machine

`quarantined → validating → processing → private → published ⇄ hidden`; `validating|processing →
rejected|failed`; `failed → processing` (reprocess); `rejected|deleted → private` (restore);
any → `deleted` (soft; purged after 30 days by `media.sweep`; guests' own deletions are immediate
and complete). `report` increments a counter without changing state. Every moderation action writes
`media_moderation` and an audit row (`media.published`, `media.hidden`, `media.moderated`).

## Visibility

Collections carry `visibility` (`public`, `guests`, `household`, `private`); an asset may narrow it.
Anonymous callers see `public`; guests with `view_private_media` see `guests` (and `household` for
their own household); `private` is admin-only. Only `published` assets appear in galleries; owners
see their own items in any state under My uploads and `get_media_item`. Duplicates
(`duplicateOfAssetId`) are hidden from galleries but shown to admins. Hidden and missing look the
same (`not_found`).

## Professional media

`admin_import_professional_media` issues tickets with a rights draft (vendor, provenance typed by an
admin, copyright holder, licence/usage notes). Files come from the admin's machine; nothing is ever
fetched from a vendor gallery. On completion a `professional_media_rights` row is created;
`allowAiProcessing` is false unless the `PRO_MEDIA_AI_PROCESSING` flag AND its readiness switch are
on AND a written-confirmation reference is supplied. Approving a professional item records
`publicationApproved` on the rights row. Credits render as `Photo: <vendor>` / `Video: <vendor>`.

## Jobs

`media.process`, `media.derive`, `media.sweep` register when `@/domain/media/jobs` loads (imported by
`src/capabilities/media`). `POST /api/uploads/jobs/run` (bearer `CRON_SECRET`) registers them in its
own module graph, keeps one sweep queued and runs a batch: schedule it alongside `/api/jobs/run`
until the foundation's cron route imports feature job modules (contract-change request).

## Video providers

`video` kind: `createAsset`/`getPlayback` (delivery) plus `extractPoster`/`probe` (processing).
Selection: Cloudflare Stream when `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_STREAM_API_TOKEN` +
`CLOUDFLARE_STREAM_CUSTOMER_CODE` exist (ingest copies from a short-lived signed read URL, playback
is signed HLS; processing delegated), else ffmpeg when `FFMPEG_PATH` or `ffmpeg` on PATH exists
(capabilities detected from the binary; the sandbox's Playwright build has no MP4 support, so it
honestly falls back to the placeholder poster), else the mock. Metadata stripping never depends on
ffmpeg.

## Test principal injector

`x-test-principal: {"kind":"guest"|"admin", …}` + `x-test-auth-secret` are honoured only when
`NODE_ENV=test` and `TEST_AUTH_SECRET` (≥ 16 chars) matches; system principals are never injectable.
Installed from `src/capabilities/media/index.ts`; inert everywhere else.

## Tests

- Unit: `tests/unit/media/*` (sniffing incl. renamed executables and polyglots, limits, keys/traversal,
  checksums, MP4 walker/strip, sharp derivatives with a GPS fixture, state machine, ACL, providers,
  upload engine with a fake transport).
- Integration: `tests/integration/media.test.ts` (PGlite + local-fs: upload → process → derive with
  GPS-absent assertions on the served bytes, expired/tampered URLs, replayed tickets, multipart
  missing-part/resume/abort, polyglot and mismatch rejection, dedupe, moderation + ACL, video,
  professional import, deletion + manifests, metrics, sweep).
- Security: `tests/security/uploads.spec.ts` (quarantine/originals never served, traversal, ACL
  across guests and anonymous, injector refusals).
- E2E: `tests/e2e/media-upload.spec.ts` (mobile batch upload with simulated interruptions, resume,
  processing states, admin bulk approval, gallery + lightbox, axe on both pages).

Run: `npm run test:unit`, `npm run test:integration`, and against a dev server started with
`NODE_ENV=test TEST_AUTH_SECRET=… CRON_SECRET=… STORAGE_SIGNING_SECRET=… CONFIRMATION_SECRET=…
NEXT_PUBLIC_SITE_URL=http://localhost:3110 MEDIA_PART_SIZE_MB=1 MEDIA_MULTIPART_THRESHOLD_MB=1`:
`BASE_URL=http://localhost:3110 npm run test:e2e` and `BASE_URL=… npx playwright test tests/security`.

## Known gaps / follow-ups

- Single-use upload URLs need a nonce in the local-fs signature and a consume step in the dev route
  (contract-change request); today expiry + completion state provide the guarantee at the app level.
- Resume relies on client-reported ETags (kept in sessionStorage); a `listMultipartParts` seam would
  let the server recover parts after a full client reset.
- No AVIF derivatives yet; no transcoding of MOV/HEVC for browsers without native support.
- The malware-scan hook is a seam (`scanHook`) with no scanner configured.
- Cost figures use an assumed price (`TODO(Tyler & Sara)` to confirm).
