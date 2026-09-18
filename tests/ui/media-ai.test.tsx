import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaSearch, describeSource } from '@/components/mediaai/MediaSearch';

// The ui project runs without globals, so testing-library's auto-cleanup is not installed.
afterEach(cleanup);


describe('search results state their provenance', () => {
  it('never calls a human caption a machine suggestion', () => {
    expect(describeSource({ sourceMetadata: { captionSource: 'ai', captionModel: 'm', humanCaption: true, indexedAt: null, scheduleSlot: 'unknown', venueClass: 'unknown', tags: [] } })).toMatch(/person who added it/);
    expect(describeSource({ sourceMetadata: { captionSource: 'ai', captionModel: 'claude-vision', humanCaption: false, indexedAt: null, scheduleSlot: 'unknown', venueClass: 'unknown', tags: [] } })).toMatch(/claude-vision, not yet reviewed/);
    expect(describeSource({ sourceMetadata: { captionSource: 'none', captionModel: null, humanCaption: false, indexedAt: null, scheduleSlot: 'unknown', venueClass: 'unknown', tags: [] } })).toMatch(/not from a description/);
  });

  it('labels every search control and offers the example queries', () => {
    render(<MediaSearch collections={[{ slug: 'guest-uploads', title: 'From our guests', description: null, kind: 'guest_uploads', chapter: null, visibility: 'guests', acceptsUploads: true, itemCount: 3 }]} />);
    expect(screen.getByLabelText(/What are you looking for/)).toBeTruthy();
    expect(screen.getByLabelText('Album')).toBeTruthy();
    expect(screen.getByLabelText('Photos or video')).toBeTruthy();
    expect(screen.getByLabelText('When')).toBeTruthy();
    for (const example of ['first dance', 'toasts', 'flowers on the table', 'outside at dusk']) {
      expect(screen.getByRole('button', { name: example })).toBeTruthy();
    }
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
