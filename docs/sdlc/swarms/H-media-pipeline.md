# Swarm H — Media storage, upload, processing, galleries (level 10)

**Ownership:** `src/domain/media/**`, `src/db/schema/media.ts`
(+ migrations), `src/providers/{storage,video}/**` (extend level-03 seams:
finish `S3CompatibleStorage` with multipart, R2 config; Cloudflare Stream
adapter skeleton + mock), `src/lib/media/**` (sniffing, limits, checksum,
derivatives via sharp, HEIC via heic-convert, EXIF read via exifr,
keyframes via `VideoProcessingProvider` mock/ffmpeg), `src/capabilities/
{create_upload,complete_upload,list_my_uploads,list_gallery,get_media_item,
admin_moderate_media,admin_import_professional_media}.ts`,
`src/app/(guest)/media/**` (QR upload page, my uploads),
`src/app/(public)/photos/**`, `src/app/(admin)/admin/media/**`,
`src/app/api/uploads/**`, jobs `media.process`, `media.derive`,
`tests/security/uploads.spec.ts`, `docs/architecture/media.md`.

**Inputs:** ADR-0005, brief §14, §2.3 (rights).

## Deliverables

1. **Storage layout**: `originals/guest/…`, `originals/professional/…`,
   `derivatives/thumb|gallery|web-full/…`, `archive/…`; private bucket;
   signed read URLs only; never expose bucket URLs.
2. **Upload**: authenticated direct-to-storage signed uploads (single +
   multipart for large video, resumable with part tracking), progress and
   retry/resume, batch selection, size caps, content-type sniffing
   independent of extension (`file-type`), allowlist JPEG/PNG/WebP/HEIC/HEIF
   and MP4/MOV; reject SVG/executables/archives/polyglots; checksum
   duplicate detection; capture timestamp/original metadata stored;
   quarantine → validate → process → private → moderated/published state
   machine; signed-URL single use + expiry.
3. **Processing**: sharp derivatives with metadata stripped (GPS never in
   served files), HEIC decode via heic-convert, video keyframe/poster via
   the provider seam (mock returns a placeholder poster; ffmpeg adapter when
   the binary exists), quality signals (sharpness/exposure) without
   subjective claims.
4. **Galleries**: `media_collections` (guest uploads, engagement, chapters
   for professional media: Full Ceremony · Toasts · First Dances · Guest
   Videos · Professional Films · Raw/Archive), ACL by visibility and
   principal, lazy-loaded responsive grids in both themes, video via the
   delivery provider.
5. **Professional import**: bulk import with vendor/provenance, copyright
   and usage notes, checksum, visibility, AI-processing permission status
   (default no), publication approval; never fetch from vendor galleries.
6. **Admin**: moderation queue (approve/reject/hide/report, bulk), duplicate
   clusters, reprocess/reindex, storage/cost metrics (approximate).

## Tests

Unit: sniffing rejects renamed executables and polyglots; limits; checksum
dedupe; state machine. Integration: upload → process → derivative with an
EXIF+GPS fixture, assert served derivative has no GPS; expired signed URL
rejected; oversize rejected; multipart complete/abort. Security: quarantine
never served; ACL for private collections across guests. E2E: mobile
upload of several files with a simulated interruption and resume; admin
approve → visible in gallery.
