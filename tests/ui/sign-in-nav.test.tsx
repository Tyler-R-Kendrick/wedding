import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { navFor } from '@/domain/lifecycle/nav';
import { getTheme } from '@/themes';

describe('Gilded Hour frieze keeps "Sign in" in view', () => {
  const { Nav } = getTheme('gilded-hour').kit;

  it.each(LIFECYCLE_STATES)('%s: the desktop frieze links to /sign-in, never only the Menu sheet', (state) => {
    // Most states carry more than six pages, which moves `more` onto the architrave line. The account
    // link used to go with neither half and vanished from the desktop header in every such state.
    const { container, unmount } = render(<Nav nav={navFor(state, { currentPath: '/' })} siteName="Sara + Tyler" homeLabel="Home" switcherEnabled={false} />);
    const frieze = [...container.querySelectorAll('.gh-frieze__side a')].map((a) => a.getAttribute('href'));
    expect(frieze).toContain('/sign-in');
    expect(frieze.length).toBeLessThanOrEqual(7);
    unmount();
  });
});
