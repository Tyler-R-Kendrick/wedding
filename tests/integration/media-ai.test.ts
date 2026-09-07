import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCapabilityContext, invokeByName } from '@/capabilities';
import type { MediaAiStatusView, MediaClusters, SearchMediaResult } from '@/capabilities/mediaai';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { FX } from '@/db/seed/fixtures';
import { mediaAssets } from '@/db/schema/media';
import { ensureDefaultCollections } from '@/domain/media';
import { getAnnotation, MEDIA_INDEX_NAMESPACE } from '@/domain/mediaai';
import { runDueJobs } from '@/lib/jobs';
import { setReadiness } from '@/lib/flags';
import { getAuditSink } from '@/lib/audit';
import { LocalFsStorage } from '@/providers/storage';
import { seedSwarmE } from './helpers/swarm-e';
import { getProvider, resetProviders, setProviderOverride } from '@/providers/registry';
import { InMemoryCosineIndex } from '@/providers/vector-index';
import { FakeMediaAi, placeCorpus, type PlacedItem } from '../helpers/media-ai-fixtures';

const WEDDING_EVENING = new Date('2027-07-18T00:30:00Z'); // 2027-07-17 19:30 Chicago
const BEFORE = new Date('2027-05-02T17:00:00Z');

const guestA: GuestPrincipal = { kind: 'guest', authIdentityId: 'auth-a' as AuthIdentityId, guestId: FX.guestA1 as GuestId, householdId: FX.householdA as HouseholdId, actsFor: [FX.guestA1 as GuestId], entitlements: new Set(['upload_media', 'view_private_media']), authenticatedAt: new Date().toISOString(), sessionId: 'sa' };
const guestB: GuestPrincipal = { ...guestA, authIdentityId: 'auth-b' as AuthIdentityId, guestId: FX.guestB1 as GuestId, householdId: FX.householdB as HouseholdId, actsFor: [FX.guestB1 as GuestId], sessionId: 'sb' };
const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'auth-adm' as AuthIdentityId, adminId: 'ADMIN1' as AdminId, roles: new Set(['owner']), entitlements: new Set(['admin_media', 'admin_ai', 'admin_lifecycle']), authenticatedAt: new Date().toISOString(), sessionId: 'sadm' };
const anon: Principal = { kind: 'anonymous' };

const clock = new Date('2027-07-20T10:00:00Z');
let dir: string;
let storage: LocalFsStorage;
const mediaAi = new FakeMediaAi();
let corpus: Map<string, PlacedItem>;

async function call<T>(principal: Principal, name: string, input?: unknown) {
  const ctx = await createCapabilityContext({ principal, requestId: newId(), now: clock, surface: 'ui', ...(principal.kind === 'anonymous' ? {} : { idempotencyKey: newId() }) });
  const r = await invokeByName(name, ctx, input);
  return r.ok ? { ok: true as const, data: r.value.data as T } : { ok: false as const, error: r.error };
}

async function runJobs(times = 4) {
  const db = await getDb();
  for (let i = 0; i < times; i++) await runDueJobs(db, { now: () => clock, worker: 'test', limit: 200 });
}

/** Index pass through the real job path (admin_reindex_media -> media.index scan -> per-asset jobs). */
async function reindexAll(opts: { full?: boolean } = {}) {
  expect((await call(admin, 'admin_reindex_media', opts.full ? { full: true } : {})).ok).toBe(true);
  await runJobs();
}

const refs = (r: { ok: true; data: SearchMediaResult } | { ok: false; error: unknown }) => (r.ok ? r.data.items.map((i) => i.id) : []);
const refOf = (assetId: string) => [...corpus.values()].find((c) => c.assetId === assetId)?.ref ?? assetId;
const namesOf = (r: { ok: true; data: SearchMediaResult } | { ok: false; error: unknown }) => refs(r).map(refOf);

describe('semantic media intelligence (PGlite + local-fs storage, deterministic providers)', () => {
  beforeAll(async () => {
    // Seed the guests these fixtures own their assets as. `media_assets` references `guests` and
    // `households` for real as of level 10; `seedSwarmE` and not `seedTestFixtures` alone because
    // `event_entitlements` references `events`, so the events must land first.
    await seedSwarmE();
    dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-media-ai-'));
    storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'integration-storage-secret-123', now: () => clock });
    resetProviders();
    setProviderOverride('storage', storage);
    setProviderOverride('media-ai', mediaAi);
    const db = await getDb();
    await ensureDefaultCollections(db, clock);
    corpus = await placeCorpus(db, storage, mediaAi, [
      { ref: 'dance', collectionSlug: 'guest-uploads', caption: 'Our first dance', capturedAt: WEDDING_EVENING, annotation: { caption: 'two people dancing under warm light', tags: ['dancing', 'reception'], venueClass: 'ballroom' } },
      { ref: 'toast', collectionSlug: 'guest-uploads', caption: 'Dad raising a toast', capturedAt: WEDDING_EVENING, annotation: { caption: 'a toast being raised at a long table', tags: ['toast', 'reception'], venueClass: 'ballroom' } },
      { ref: 'flowers', collectionSlug: 'guest-uploads', caption: 'Peonies on the head table', capturedAt: WEDDING_EVENING, annotation: { caption: 'flowers in a vase on a table', tags: ['flowers', 'detail'], venueClass: 'indoor' } },
      { ref: 'dusk', collectionSlug: 'guest-uploads', capturedAt: WEDDING_EVENING, annotation: { caption: 'friends outside on a rooftop at dusk', tags: ['outdoor', 'evening'], venueClass: 'rooftop' } },
      { ref: 'hallway', collectionSlug: 'guest-uploads', caption: 'The stairs on the way in', capturedAt: BEFORE, annotation: { caption: 'a quiet hallway', tags: ['architecture'], venueClass: 'indoor' } },
      { ref: 'lakefront', collectionSlug: 'engagement', caption: 'The proposal by the lake', capturedAt: BEFORE, annotation: { caption: 'two people by the water', tags: ['portrait'], venueClass: 'lakefront' } },
      { ref: 'speeches-video', collectionSlug: 'guest-uploads', kind: 'video', caption: 'More speeches', capturedAt: WEDDING_EVENING, annotation: { caption: 'a toast being raised', tags: ['toast'] } },
      { ref: 'ceremony-pro', collectionSlug: 'full-ceremony', source: 'professional', vendor: 'brooke-alaina-photography', capturedAt: WEDDING_EVENING, caption: null, rights: { vendorName: 'Brooke Alaina Photography', allowAiProcessing: false }, annotation: { caption: 'THIS MUST NEVER BE INDEXED', tags: ['leak'] } },
      { ref: 'not-published', collectionSlug: 'guest-uploads', status: 'private', caption: 'Our first dance, another angle', capturedAt: WEDDING_EVENING },
      { ref: 'someone-elses', collectionSlug: 'guest-uploads', ownerGuestId: FX.guestB1, ownerHouseholdId: FX.householdB, visibility: 'private', caption: 'Our first dance from the balcony', capturedAt: WEDDING_EVENING },
      // A burst: three frames, same camera, one second apart, one clearly sharpest.
      { ref: 'burst-1', collectionSlug: 'guest-uploads', capturedAt: new Date('2027-07-18T01:00:00Z'), dhash: 'ffffffffffffffff', cameraModel: 'BurstCam', sharpness: 5, caption: 'Confetti' },
      { ref: 'burst-2', collectionSlug: 'guest-uploads', capturedAt: new Date('2027-07-18T01:00:01Z'), dhash: 'ffffffffffffffff', cameraModel: 'BurstCam', sharpness: 40, caption: 'Confetti' },
      { ref: 'burst-3', collectionSlug: 'guest-uploads', capturedAt: new Date('2027-07-18T01:00:02Z'), dhash: 'fffffffffffffffe', cameraModel: 'BurstCam', sharpness: 9, caption: 'Confetti' },
    ], clock);
    await reindexAll();
  });

  afterAll(async () => {
    resetProviders();
    await rm(dir, { recursive: true, force: true });
  });

  it('indexes every processed asset and records where each description came from', async () => {
    const db = await getDb();
    const dance = await getAnnotation(db, corpus.get('dance')!.assetId);
    expect(dance).toMatchObject({ status: 'indexed', captionSource: 'ai', venueClass: 'ballroom', scheduleSlot: 'wedding_evening' });
    expect(dance!.indexText).toContain('Our first dance');
    expect(dance!.indexText).toContain('two people dancing under warm light');
    expect(dance!.derivativeKey!.startsWith('derivatives/')).toBe(true);
    expect(dance!.suggestedAltText).toBeTruthy();
    // Assets with no capture time are honest about it rather than guessing.
    expect((await getAnnotation(db, corpus.get('lakefront')!.assetId))!.scheduleSlot).toBe('before_wedding');
  });

  it('never sends professional media to a provider without written confirmation', async () => {
    const db = await getDb();
    const pro = corpus.get('ceremony-pro')!;
    expect(mediaAi.calls).not.toContain(pro.derivativeKey);
    const annotation = await getAnnotation(db, pro.assetId);
    expect(annotation).toMatchObject({ status: 'indexed', captionSource: 'none', skipReason: 'pro_media_ai_off' });
    expect(annotation!.suggestedCaption).toBeNull();
    // It is still findable from its own metadata: the album and chapter, never an invented caption.
    expect(annotation!.indexText).toContain('Full Ceremony');
    expect(annotation!.indexText).not.toContain('THIS MUST NEVER BE INDEXED');
    // ...and the photographer is not named in the text that goes to the embeddings provider.
    expect(annotation!.indexText).not.toContain('Brooke Alaina Photography');
    expect(annotation!.indexText).toContain('professional');
  });

  it('only ever hands a metadata-stripped derivative to the provider', () => {
    expect(mediaAi.calls.length).toBeGreaterThan(0);
    for (const key of mediaAi.calls) expect(key.startsWith('derivatives/')).toBe(true);
  });

  it('answers the example queries with the right items', async () => {
    expect(namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'first dance' }))[0]).toBe('dance');
    expect(namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'toasts' }))).toContain('toast');
    expect(namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'flowers on the table' }))[0]).toBe('flowers');
    expect(namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'outside at dusk' }))[0]).toBe('dusk');
  });

  it('searches with BIOMETRICS_ENABLED explicitly off — the archive does not depend on the vault', async () => {
    // Named rather than left incidental. Every other case in this file happens to run with the flag
    // off, so search-without-biometrics was covered by accident; ADR-0006's whole bet is that the
    // site ships every archive feature with the vault switched off, and a guarantee nobody asserts
    // is one a later level can remove without noticing. Asserted against the flag set explicitly.
    delete process.env.FLAG_BIOMETRICS_ENABLED;
    const hits = namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'first dance' }));
    expect(hits[0], 'semantic search must answer with the vault off').toBe('dance');
    expect(namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'toasts' })), 'and keep answering').toContain('toast');
  });

  it('explains a hit with the terms that actually matched and the source of the text', async () => {
    const r = await call<SearchMediaResult>(guestA, 'search_media', { query: 'first dance' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hit = r.data.items[0]!;
    expect(hit.matchedTerms).toEqual(expect.arrayContaining(['first', 'dance']));
    expect(hit.collection).toMatchObject({ slug: 'guest-uploads' });
    expect(hit.sourceMetadata).toMatchObject({ captionSource: 'ai', humanCaption: true, venueClass: 'ballroom', scheduleSlot: 'wedding_evening' });
    expect(hit.sourceMetadata.captionModel).toBe('fake-annotator-1');
    expect(hit.thumb?.url).toContain('/api/dev/storage/derivatives/');
    expect(r.data.embeddingModel).toBeTruthy();
  });

  it('returns only what the caller may see', async () => {
    const mine = namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'first dance' }));
    expect(mine).not.toContain('not-published');
    expect(mine).not.toContain('someone-elses');
    // Anonymous visitors search public albums only.
    const publicOnly = await call<SearchMediaResult>(anon, 'search_media', { query: 'the proposal by the lake' });
    expect(namesOf(publicOnly)).toEqual(['lakefront']);
    expect(namesOf(await call<SearchMediaResult>(anon, 'search_media', { query: 'first dance' }))).toEqual([]);
    // "private" is owner-scoped, not hidden-from-everyone: its own owner still finds it.
    const theirs = namesOf(await call<SearchMediaResult>(guestB, 'search_media', { query: 'first dance' }));
    expect(theirs).toContain('dance');
    expect(theirs).toContain('someone-elses');
  });

  it('filters by album, kind and schedule slot without changing who may see what', async () => {
    expect(namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'toast', kind: 'video' }))).toEqual(['speeches-video']);
    expect(namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'toast', collection: 'engagement' }))).toEqual([]);
    const evening = await call<SearchMediaResult>(guestA, 'search_media', { query: 'toast', scheduleSlot: 'wedding_evening' });
    expect(namesOf(evening)).toContain('toast');
    expect(namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'toast', scheduleSlot: 'before_wedding' }))).not.toContain('toast');
  });

  it('returns nothing rather than something wrong for a query with no match', async () => {
    const r = await call<SearchMediaResult>(guestA, 'search_media', { query: 'a snowstorm in the parking garage' });
    expect(r.ok && r.data.items).toEqual([]);
    // ...while a query that really does share a word still finds it, and says which word.
    const partial = await call<SearchMediaResult>(guestA, 'search_media', { query: 'from the rooftop' });
    expect(namesOf(partial)).toEqual(['dusk']);
    expect(partial.ok && partial.data.items[0]!.matchedTerms).toEqual(['rooftop']);
  });

  it('works the same through the in-memory cosine fallback as through the database index', async () => {
    const db = await getDb();
    const dbIndexName = getProvider('vector-index', { db }).name;
    // Whichever backend the database offers is the one that answered the assertions above.
    expect(dbIndexName).toBe(db.vectorAvailable ? 'pgvector' : 'memory');
    const viaDb = namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'first dance' }));
    const memory = new InMemoryCosineIndex(getProvider('embeddings').dims, { shared: false });
    setProviderOverride('vector-index', memory);
    try {
      // Nothing about the assets changed, everything about the index did: that is what `full` is for.
      await reindexAll({ full: true });
      const viaMemory = await call<SearchMediaResult>(guestA, 'search_media', { query: 'first dance' });
      expect(viaMemory.ok && viaMemory.data.index).toBe('memory');
      expect(namesOf(viaMemory)).toEqual(viaDb);
      expect(namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'flowers on the table' }))[0]).toBe('flowers');
    } finally {
      setProviderOverride('vector-index', undefined);
      await reindexAll({ full: true });
    }
    // The default path in this environment is whatever the database offers (pgvector when present).
    expect(['pgvector', 'memory']).toContain(dbIndexName);
    const restored = await call<SearchMediaResult>(guestA, 'search_media', { query: 'first dance' });
    expect(restored.ok && restored.data.index).toBe(dbIndexName);
    expect(namesOf(restored)).toEqual(viaDb);
  });

  it('drops an asset from the index as soon as it leaves the gallery', async () => {
    const db = await getDb();
    const flowers = corpus.get('flowers')!;
    await db.update(mediaAssets).set({ status: 'hidden', updatedAt: clock }).where(eq(mediaAssets.id, flowers.assetId));
    await reindexAll();
    expect(namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'flowers on the table' }))).not.toContain('flowers');
    await db.update(mediaAssets).set({ status: 'published', updatedAt: clock }).where(eq(mediaAssets.id, flowers.assetId));
    await reindexAll();
    expect(namesOf(await call<SearchMediaResult>(guestA, 'search_media', { query: 'flowers on the table' }))[0]).toBe('flowers');
  });

  it('offers suggestions to the owner and an admin, and only an admin can publish one', async () => {
    const dusk = corpus.get('dusk')!;
    const mine = await call<{ suggestion: { suggestedAltText: string | null }; canApply: boolean; current: { altText: string | null } }>(guestA, 'suggest_alt_text', { assetId: dusk.assetId });
    expect(mine.ok && mine.data.canApply).toBe(false);
    expect(mine.ok && mine.data.suggestion?.suggestedAltText).toBeTruthy();
    expect((await call(guestB, 'suggest_alt_text', { assetId: dusk.assetId })).ok).toBe(false);
    expect((await call(guestB, 'admin_apply_media_text', { assetId: dusk.assetId, altText: 'hijacked' })).ok).toBe(false);

    const applied = await call<{ altText: string | null }>(admin, 'admin_apply_media_text', { assetId: dusk.assetId, altText: '  Friends on the rooftop as the sun goes down.  ' });
    expect(applied.ok && applied.data.altText).toBe('Friends on the rooftop as the sun goes down.');
    await runJobs();
    const db = await getDb();
    expect((await getAnnotation(db, dusk.assetId))!.reviewedAt).not.toBeNull();
    const after = await call<{ current: { altText: string | null } }>(guestA, 'suggest_alt_text', { assetId: dusk.assetId });
    expect(after.ok && after.data.current.altText).toBe('Friends on the rooftop as the sun goes down.');
  });

  it('groups bursts and picks the sharpest frame, for admins only', async () => {
    expect((await call(guestA, 'get_media_clusters', {})).ok).toBe(false);
    const clusters = await call<MediaClusters>(admin, 'get_media_clusters', { kind: 'burst' });
    expect(clusters.ok).toBe(true);
    if (!clusters.ok) return;
    const burst = clusters.data.clusters.find((c) => c.items.length === 3);
    expect(burst).toBeDefined();
    expect(burst!.items.map((i) => refOf(i.id)).sort()).toEqual(['burst-1', 'burst-2', 'burst-3']);
    expect(refOf(burst!.representativeAssetId)).toBe('burst-2');
    expect(burst!.items.find((i) => i.representative)!.id).toBe(burst!.representativeAssetId);
  });

  it('reports index coverage, provider modes and the professional-media gate to admins', async () => {
    expect((await call(guestA, 'admin_media_ai_status', {})).ok).toBe(false);
    const status = await call<MediaAiStatusView>(admin, 'admin_media_ai_status', {});
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.flags.semanticSearch).toBe(true);
    expect(status.data.flags.proMediaAi).toEqual({ flag: false, readiness: false, enabled: false });
    expect(status.data.providers.mediaAi).toEqual({ name: 'fake', mode: 'mock' });
    expect(status.data.status.annotations.byStatus['indexed']).toBeGreaterThan(5);
    expect(status.data.status.annotations.bySkipReason['pro_media_ai_off']).toBe(1);
    expect(status.data.status.lastIndexedAt).toBeTruthy();
  });

  it('sends professional media to a provider once the flag, readiness and confirmation all hold', async () => {
    const db = await getDb();
    const pro = corpus.get('ceremony-pro')!;
    process.env.FLAG_PRO_MEDIA_AI_PROCESSING = 'on';
    await setReadiness(db, { flag: 'PRO_MEDIA_AI_PROCESSING', ready: true, actor: { kind: 'system', component: 'test' }, requestId: newId(), audit: await getAuditSink() });
    try {
      // Flag + readiness are on, but the rights row still says no.
      await call(admin, 'admin_reindex_media', { assetId: pro.assetId });
      await runJobs();
      expect(mediaAi.calls).not.toContain(pro.derivativeKey);
      expect((await getAnnotation(db, pro.assetId))!.skipReason).toBe('pro_media_ai_off');
      // With written confirmation on file it is finally allowed.
      const { professionalMediaRights } = await import('@/db/schema/media');
      await db.update(professionalMediaRights).set({ allowAiProcessing: true, aiProcessingConfirmationRef: 'https://example.invalid/riders/oakhouse-2026-03-14-ai-clause', updatedAt: clock }).where(eq(professionalMediaRights.assetId, pro.assetId));
      await db.update(mediaAssets).set({ updatedAt: new Date(clock.getTime() + 1000) }).where(eq(mediaAssets.id, pro.assetId));
      await call(admin, 'admin_reindex_media', { assetId: pro.assetId });
      await runJobs();
      expect(mediaAi.calls).toContain(pro.derivativeKey);
      const confirmed = await getAnnotation(db, pro.assetId);
      expect(confirmed).toMatchObject({ captionSource: 'ai', skipReason: null });
      // With confirmation on file the credit goes back into the indexed text.
      expect(confirmed!.indexText).toContain('Brooke Alaina Photography');
    } finally {
      delete process.env.FLAG_PRO_MEDIA_AI_PROCESSING;
      await setReadiness(db, { flag: 'PRO_MEDIA_AI_PROCESSING', ready: false, actor: { kind: 'system', component: 'test' }, requestId: newId(), audit: await getAuditSink() });
    }
  });

  it('stops indexing entirely when MEDIA_SEMANTIC_SEARCH is off', async () => {
    const db = await getDb();
    process.env.FLAG_MEDIA_SEMANTIC_SEARCH = 'off';
    try {
      await reindexAll({ full: true });
      const dance = await getAnnotation(db, corpus.get('dance')!.assetId);
      expect(dance).toMatchObject({ skipReason: 'search_disabled', captionSource: 'none' });
      expect(dance!.suggestedCaption).toBeNull();
      const search = await call<SearchMediaResult>(guestA, 'search_media', { query: 'first dance' });
      expect(search.ok).toBe(false);
      if (!search.ok) expect(search.error.code).toBe('feature_disabled');
      const index = getProvider('vector-index', { db });
      const left = await index.query(MEDIA_INDEX_NAMESPACE, { vector: new Array(getProvider('embeddings').dims).fill(0.1), k: 50 });
      expect(left.ok && left.value).toEqual([]);
    } finally {
      delete process.env.FLAG_MEDIA_SEMANTIC_SEARCH;
      await reindexAll({ full: true });
    }
  });
});

/**
 * The gate that decides whether a professional photographer's work is sent to an external
 * captioning and embeddings provider. It accepted any non-empty string until this level, so `"x"`
 * opened it — and so did the literal authoring marker, which is what the case above was passing
 * before it was corrected. Same defect the adversarial review recorded as F5 against the BIPA
 * readiness gate; that one was fixed with `COUNSEL_REVIEW_REF`, this one was not in its scope.
 *
 * Run against the previous schema (`z.string().max(200)`) every one of these is accepted, which is
 * the point of listing the placeholder shapes explicitly rather than one short string.
 */
describe('professional media AI-rights confirmation', () => {
  const reject = ['x', 'yes', 'signed', 'asd', 'TODO(Tyler & Sara)', 'TODO(Tyler & Sara): signed rider', 'confirmed by phone'];
  const accept = [
    'https://example.invalid/riders/oakhouse-2026-03-14-ai-clause',
    'ADR-0005 §4',
    'LEGAL-4821',
    'signed rider dated 2026-03-14',
  ];

  it('refuses a reference nobody could follow, and accepts one they could', async () => {
    const { RIGHTS_CONFIRMATION_REF } = await import('@/capabilities/media/admin_import_professional_media');
    for (const bad of reject) expect(RIGHTS_CONFIRMATION_REF.safeParse(bad).success, `must refuse: ${bad}`).toBe(false);
    for (const good of accept) expect(RIGHTS_CONFIRMATION_REF.safeParse(good).success, `must accept: ${good}`).toBe(true);
  });

  it('each gate accepts the example its own error message offers', async () => {
    // Both validators tell an admin that an ADR section is an acceptable reference, and both had a
    // `min(12)` that rejected one: `ADR-0006 §7` is eleven characters. A validator that refuses the
    // answer its own message asks for is a defect the message hides.
    const { RIGHTS_CONFIRMATION_REF } = await import('@/capabilities/media/admin_import_professional_media');
    const { COUNSEL_REVIEW_REF } = await import('@/capabilities/biometrics/admin_enable_biometric_readiness');
    expect(COUNSEL_REVIEW_REF.safeParse('ADR-0006 §7').success, 'the counsel gate must accept the ADR section it names').toBe(true);
    expect(RIGHTS_CONFIRMATION_REF.safeParse('ADR-0005 §4').success, 'the rights gate must accept an ADR section too').toBe(true);
  });
});
