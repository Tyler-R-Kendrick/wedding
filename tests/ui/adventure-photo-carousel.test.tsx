/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdventurePhotoCarousel } from '@/components/adventures/AdventurePhotoCarousel';

describe('AdventurePhotoCarousel', () => {
  beforeEach(() => {
    window.matchMedia = (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  });
  it('renders a single photo without carousel controls', () => {
    render(<AdventurePhotoCarousel photos={[{ alt: 'One', src: '/assets/photos/adventures/x.webp' }]} />);
    expect(screen.getByRole('img', { name: 'One' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Previous photo/ })).toBeNull();
  });

  it('exposes carousel controls for several photos', () => {
    render(
      <AdventurePhotoCarousel
        photos={[
          { alt: 'First', src: '/a.webp' },
          { alt: 'Second', src: '/b.webp' },
        ]}
      />,
    );
    expect(screen.getByRole('region', { name: 'Photos from this adventure' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeTruthy();
    expect(screen.getByText('Photo 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(screen.getByText('Photo 2 of 2')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Second' })).toBeTruthy();
  });
});
