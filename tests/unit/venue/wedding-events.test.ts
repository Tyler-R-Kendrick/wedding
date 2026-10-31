import { describe, expect, it } from 'vitest';
import { weddingEventSkeleton } from '@/domain/venue/wedding-events';
import { toProvenanceView } from '@/domain/content/provenance';
import { SOURCE_KEYS } from '@/content/sources';

describe('weddingEventSkeleton', () => {
  it('includes guest arrival and end of celebration rows', () => {
    const provenance = toProvenanceView(
      {
        sourceId: SOURCE_KEYS.brief,
        sourceType: 'authored',
        sourceUrl: null,
        verifiedAt: new Date('2026-09-04'),
        validFrom: null,
        validUntil: null,
        trustClass: 'TRUSTED_WEDDING',
        contentVersion: 1,
        editedBy: 'test',
      },
      { route: '/the-wedding', now: new Date('2026-10-01'), sources: new Map() },
    );
    const events = weddingEventSkeleton(provenance);
    expect(events.map((e) => e.id)).toEqual(['guest-arrival', 'ceremony', 'cocktail-hour', 'reception', 'end-of-celebration']);
    expect(events[0]?.name).toBe('Guest arrival');
    expect(events.at(-1)?.name).toBe('End of celebration');
  });
});
