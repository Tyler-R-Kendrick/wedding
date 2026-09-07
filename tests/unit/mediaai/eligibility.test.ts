import { describe, expect, it } from 'vitest';
import type { MediaAssetRow, MediaDerivativeRow, ProfessionalMediaRightsRow } from '@/db/schema/media';
import { aiEligibility, isIndexableStatus, pickAiDerivative, professionalAiAllowed } from '@/domain/mediaai/eligibility';

const derivative = (over: Partial<MediaDerivativeRow> = {}): MediaDerivativeRow =>
  ({
    id: 'D',
    assetId: 'A',
    variant: 'gallery',
    format: 'webp',
    key: 'derivatives/A/gallery.webp',
    contentType: 'image/webp',
    width: 1600,
    height: 1067,
    bytes: 1000,
    metadataStripped: true,
    createdAt: new Date(),
    ...over,
  }) as MediaDerivativeRow;

const asset = (over: Partial<MediaAssetRow> = {}) => ({ status: 'published', source: 'guest', kind: 'image', deletedAt: null, ...over }) as Pick<MediaAssetRow, 'status' | 'source' | 'kind' | 'deletedAt'>;
const rights = (allow: boolean) => ({ allowAiProcessing: allow }) as Pick<ProfessionalMediaRightsRow, 'allowAiProcessing'>;
const flagsOn = { MEDIA_SEMANTIC_SEARCH: true, PRO_MEDIA_AI_PROCESSING: true } as const;

describe('what the indexer may send to a provider', () => {
  it('only ever picks a metadata-stripped derivative, JPEG before WebP', () => {
    const webp = derivative({ id: 'w', format: 'webp' });
    const jpeg = derivative({ id: 'j', format: 'jpeg', key: 'derivatives/A/gallery.jpg' });
    expect(pickAiDerivative('image', [webp, jpeg])?.id).toBe('j');
    expect(pickAiDerivative('video', [webp, jpeg])).toBeUndefined();
    expect(pickAiDerivative('video', [derivative({ variant: 'poster', format: 'jpeg' })])?.variant).toBe('poster');
  });

  it('refuses originals, quarantine keys and un-stripped derivatives', () => {
    expect(pickAiDerivative('image', [derivative({ key: 'originals/guest/A/original.jpg' })])).toBeUndefined();
    expect(pickAiDerivative('image', [derivative({ key: 'quarantine/U/original' })])).toBeUndefined();
    expect(pickAiDerivative('image', [derivative({ metadataStripped: false })])).toBeUndefined();
  });

  it('indexes only processed assets', () => {
    for (const s of ['private', 'published', 'hidden']) expect(isIndexableStatus(s)).toBe(true);
    for (const s of ['quarantined', 'validating', 'processing', 'rejected', 'failed', 'deleted']) expect(isIndexableStatus(s)).toBe(false);
  });
});

describe('eligibility gate', () => {
  const derivs = [derivative()];

  it('allows a processed guest photo when semantic search is on', () => {
    expect(aiEligibility({ asset: asset(), derivatives: derivs, rights: null, flags: flagsOn, readiness: {} })).toEqual({ ai: true, derivative: derivs[0] });
  });

  it('refuses deleted, unprocessed and derivative-less assets before anything else', () => {
    expect(aiEligibility({ asset: asset({ deletedAt: new Date() }), derivatives: derivs, rights: null, flags: flagsOn, readiness: {} })).toMatchObject({ ai: false, reason: 'deleted' });
    expect(aiEligibility({ asset: asset({ status: 'quarantined' }), derivatives: derivs, rights: null, flags: flagsOn, readiness: {} })).toMatchObject({ ai: false, reason: 'not_processed' });
    expect(aiEligibility({ asset: asset(), derivatives: [], rights: null, flags: flagsOn, readiness: {} })).toMatchObject({ ai: false, reason: 'no_derivative' });
  });

  it('sends nothing anywhere when MEDIA_SEMANTIC_SEARCH is off', () => {
    expect(aiEligibility({ asset: asset(), derivatives: derivs, rights: null, flags: { ...flagsOn, MEDIA_SEMANTIC_SEARCH: false }, readiness: {} })).toMatchObject({ ai: false, reason: 'search_disabled' });
  });

  it('needs flag AND readiness AND written confirmation for professional media', () => {
    const pro = asset({ source: 'professional' });
    const cases: [boolean, boolean, boolean, boolean][] = [
      // flag, readiness, rights.allowAiProcessing, expected
      [false, false, false, false],
      [true, false, true, false],
      [true, true, false, false],
      [false, true, true, false],
      [true, true, true, true],
    ];
    for (const [flag, readiness, allow, expected] of cases) {
      const flags = { MEDIA_SEMANTIC_SEARCH: true, PRO_MEDIA_AI_PROCESSING: flag };
      expect(professionalAiAllowed(rights(allow), flags, { PRO_MEDIA_AI_PROCESSING: readiness })).toBe(expected);
      const e = aiEligibility({ asset: pro, derivatives: derivs, rights: rights(allow), flags, readiness: { PRO_MEDIA_AI_PROCESSING: readiness } });
      expect(e.ai).toBe(expected);
      if (!expected) expect(e).toMatchObject({ reason: 'pro_media_ai_off' });
    }
    // No rights row at all is the same as no confirmation.
    expect(professionalAiAllowed(null, flagsOn, { PRO_MEDIA_AI_PROCESSING: true })).toBe(false);
  });

  it('fails closed when readiness is unknown', () => {
    expect(professionalAiAllowed(rights(true), flagsOn, {})).toBe(false);
  });
});
