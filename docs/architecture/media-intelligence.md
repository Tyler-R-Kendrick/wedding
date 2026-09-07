# Semantic media intelligence (Swarm I)

Captions, tags, embeddings, semantic search and clustering over the media pipeline
([media.md](media.md), Swarm H). Everything here is **non-biometric** and ships enabled behind
`MEDIA_SEMANTIC_SEARCH`. Face matching is a separate, gated-off subsystem:
[biometrics-bipa-readiness.md](biometrics-bipa-readiness.md).

Decisions: [ADR-0002](../adr/0002-capability-layer.md) (one door),
[ADR-0005](../adr/0005-media-storage-model.md) (private originals, served derivatives),
[ADR-0007](../adr/0007-provider-adapters-and-fallbacks.md) (provider seams), brief §7
(professional rights, `PRO_MEDIA_AI_PROCESSING` off).

## Layout

| Layer | Path | What lives there |
|---|---|---|
| Domain | `src/domain/mediaai/` | `text.ts` (schedule alignment, venue classification, the embedded document, stemming and lexical scoring), `eligibility.ts` (what may be sent where), `indexer.ts` (one asset in, one annotation + one vector out), `search.ts` (ACL-filtered retrieval), `clusters.ts` (bursts and duplicate groups), `status.ts`, `jobs.ts` (`media.index`, `media.cluster`) |
| Schema | `src/db/schema/media_ai.ts`, migration `0003` | `media_ai_annotations` (one row per asset), `media_ai_clusters` |
| Providers | `src/providers/media-ai/`, `src/providers/embeddings/`, `src/providers/vector-index/` | captions/tags/venue class; text embeddings; the vector index (pgvector or in-memory cosine) |
| Capabilities | `src/capabilities/mediaai/` | `search_media`, `suggest_alt_text`, `get_media_clusters`, `admin_apply_media_text`, `admin_media_ai_status`, `admin_reindex_media` |
| Routes | `src/app/api/media-ai/jobs/run` | cron alias that keeps one index scan, one cluster pass and one retention sweep queued |
| UI | `src/components/mediaai/`, `src/app/(guest)/media/search`, `src/app/(admin)/admin/ai` | `mediaai.css`, DESIGN.md tokens only |

## What the index is made of

`media_ai_annotations.index_text` is the document that gets embedded, and it is readable on
purpose — an admin can look at a row and see exactly why something was found:

```
<guest caption>. <guest alt text>. <suggested caption>. <suggested alt text>. <tags>.
album: <collection title>. chapter: <chapter words>. photo|video clip.
[professional by <vendor>.] [setting: <venue class>.] [when: <schedule slot>.]
```

Human text comes first because it is the truth; suggestions are drafts. Every structural fact is
*derived*, never invented:

- **Schedule slot** is the capture time bucketed in `America/Chicago` against the wedding date:
  before / morning / afternoon / evening / night / after, or `unknown`. The actual run of day
  (ceremony start, cocktail hour, dinner, dancing) is `TODO(Tyler & Sara)`; until it exists nothing
  finer is claimed.
- **Venue class** comes from the provider's coarse class or a venue-like tag, and is `unknown`
  otherwise. It is **never** derived from GPS: the pipeline discards location before an asset is
  ever stored.
- **Credit** for professional media comes from the rights row, not from a model.

## What may be sent to a provider

`aiEligibility()` is the single gate, and it is pure so it can be unit-tested exhaustively:

1. Deleted or unprocessed assets are never read at all.
2. Only a **derivative** is ever handed to a provider — the gallery JPEG/WebP, or the poster for a
   video, and only when it is metadata-stripped. `isServableKey` is asserted a second time in the
   indexer, so an original or a quarantine key cannot reach a provider even by mistake.
3. With `MEDIA_SEMANTIC_SEARCH` off, nothing is sent anywhere and existing vectors are removed.
4. **Professional media** (Brooke Alaina Photography, Oakhouse Visuals) reaches the *vision*
   provider only when `PRO_MEDIA_AI_PROCESSING` is on **and** its readiness switch is on **and** the
   rights row carries written confirmation (brief §7). Otherwise the image is never sent and no
   caption is suggested.

   It is still indexed from its own metadata, and — being precise, because an earlier version of
   this document was not — **that metadata is embedded, and the embeddings provider is a live
   third-party API when `VOYAGE_API_KEY` or `OPENAI_API_KEY` is set.** What goes is our own text:
   the album and chapter, the admin-written caption and alt text, the kind, and the fact that the
   item is professional. What does not go is the image and **the photographer's name**, which is
   withheld from the embedded document precisely because naming the vendor beside a description of
   their frame is the same disclosure in text that withholding the picture avoids. Search stays
   complete; the licence is not stretched.

   If even that is judged too much for a particular vendor, the next step is to skip
   `embeddings.embed` for `pro_media_ai_off` assets entirely and let the lexical half of the blend
   carry them — weaker recall, no third-party call at all. That is a couple-and-vendor decision,
   not an engineering one.

An asset that is not eligible still gets an annotation row with a `skip_reason`, so
`/admin/ai` can show what is not being described and why.

## Search

```
query ─▶ embeddings.embed ─▶ vectorIndex.query(namespace "media", k = 4×limit, filter { published })
      ─▶ per hit: reload the asset + collection rows
      ─▶ canViewPublishedAsset(principal, asset, collection)      ← authorization, never the index
      ─▶ blendScore(cosine, lexicalOverlap) with a floor
      ─▶ matchedQueryTerms(query, indexText)                       ← the guest-visible "why"
```

Three properties worth keeping:

- **The index only pre-filters.** Authorization is Swarm H's `canViewPublishedAsset`, re-checked per
  hit against the live rows, so a stale index entry can never leak a hidden or deleted item. The
  integration tests assert this per principal (anonymous, two guests, admin).
- **The score is honest.** `blendScore` mixes cosine similarity with lexical overlap, and the "why
  it matched" list is computed with the *same* matcher as the score, so the UI can never claim a
  term the ranking did not use. Matching is stem-tolerant ("first dance" finds "dancing").
- **No match means no results.** Every document carries the same boilerplate (`album: …`, `photo`),
  so an unrelated item still scores a moderate cosine against any query. A hit that shares no word
  with the query must clear `SEARCH_MIN_COSINE_WITHOUT_TERMS` on similarity alone; otherwise the
  answer is an empty result, not the nearest thing to hand.

## The vector index seam

`createVectorIndexProvider({ dims, db })` picks the backend; `dims` comes from the embeddings
provider so the two can never drift apart.

| Environment | Backend | Notes |
|---|---|---|
| Production / staging on Postgres with pgvector | `PgVectorIndex` | Creates `vector_index_items` lazily on first use, so the committed migrations never depend on the extension. Cosine distance (`<=>`), metadata pre-filter with `@>`. |
| Local dev on PGlite with `@electric-sql/pglite-pgvector` | `PgVectorIndex` | Identical SQL path; this is what the integration suite runs against. |
| Anywhere the extension is missing, and `FORCE_MOCK_PROVIDERS` | `InMemoryCosineIndex` | Exact cosine over a process-local map. Fine for a few thousand vectors; not persistent. |

Every path fails soft: a pgvector error becomes a `ProviderFailure`, search returns nothing, and
the annotation row records why. Switching backend does not change search results — the integration
test runs the same queries through both and compares.

## Jobs

| Job | Payload | What it does |
|---|---|---|
| `media.index` | `{ assetId }` | Indexes one asset (eligibility → annotation → embedding → upsert). |
| `media.index` | `{ scan: true, full? }` | Enqueues one deduped job per asset that needs work. `full` ignores the "changed since the last pass" watermark — for a new embeddings model, a different vector backend, or a flag change, where nothing about the assets changed but everything about the index did. |
| `media.cluster` | — | Recomputes bursts and duplicate groups. |

`POST /api/media-ai/jobs/run` (bearer `CRON_SECRET`) keeps one scan, one cluster pass and one
biometric retention sweep queued and then runs a bounded batch. **Contract-change request:** the
foundation cron route should import feature job modules so one schedule covers everything; until
then this alias is scheduled alongside `/api/jobs/run`.

## Clustering

Bursts are consecutive frames from one camera (same uploader/vendor and camera model) captured
within three seconds of each other whose perceptual hashes are close, at least three frames long.
The representative is the **sharpest** frame by the pipeline's numeric quality signal — never a
subjective "best". Exact and near-duplicate groups come from Swarm H's `listDuplicateClusters`.

## Suggestions are drafts

`media_assets.caption` / `alt_text` stay the published truth. A model's output lives in
`media_ai_annotations.suggested_*` and reaches a guest only through `admin_apply_media_text`, which
publishes the **admin-edited** text and marks the suggestion reviewed. The review queue on
`/admin/ai` puts the suggestion in an editable field for exactly that reason. Provider output is
`UNTRUSTED_USER_CONTENT`: data, never instructions.

## Known limits

- The default embeddings provider outside production is a hashed bag-of-words. It is deterministic
  and cheap, and keeps tests honest, but it has no real semantics: "dance" and "dancing" are only
  related because of the lexical half of the blend. With a real provider (`VOYAGE_API_KEY` /
  `OPENAI_API_KEY`) vector recall does that work. Re-index with `full` after changing the model.
- Video is indexed from its poster frame plus its metadata. Per-scene descriptions exist in the
  seam (`describeScenes`) but are not stored yet.
- The vector index has no re-ranking stage; `k` is `4 × limit`, which is ample for an archive of
  this size and would need revisiting at a much larger scale.
