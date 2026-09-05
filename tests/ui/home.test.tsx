import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LIFECYCLE_MODE, LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';
import { SEED_SITE } from '@/db/seed/seed';
import { countdownView } from '@/domain/lifecycle/countdown';
import { toSiteFacts } from '@/domain/lifecycle/facts';
import { navFor } from '@/domain/lifecycle/nav';
import { getTheme } from '@/themes';
import { THEME_IDS } from '@/themes/registry';
import { homeContent } from '@/themes/shared/home-content';
import type { HomeData, ThemeId } from '@/themes/types';

const NOW = new Date('2026-09-05T12:00:00Z');
const site = toSiteFacts({ ...SEED_SITE });

function homeData(theme: ThemeId, state: LifecycleState): HomeData {
  return {
    theme,
    site,
    lifecycle: { state, mode: LIFECYCLE_MODE[state], persistedState: state, preview: null, suggested: 'RSVP_OPEN', publishedAt: null, note: null },
    countdown: countdownView(NOW),
    nav: navFor(state, { venue: site.venue, currentPath: '/' }),
    switcher: null,
    content: homeContent(site, state),
  };
}

describe.each(THEME_IDS)('Home recipe (%s)', (theme) => {
  const t = getTheme(theme);

  it.each(LIFECYCLE_STATES)('%s: names, date with weekday, venue, primary action, landmarks', (state) => {
    const data = homeData(theme, state);
    const { container, unmount } = render(<>{t.recipes.home(data)}</>);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent?.replace(/\s+/g, ' ').trim()).toBe(state === 'WEDDING_DAY' ? 'Today' : 'Sara + Tyler');
    expect(container.querySelector(`[data-theme="${theme}"]`)).not.toBeNull();
    expect(container.querySelector('time[datetime="2027-07-17"]')).not.toBeNull();
    expect(container.textContent).toContain('Saturday, July 17, 2027');
    expect(container.textContent).toContain('Chicago Athletic Association Hotel');
    expect(screen.getByRole('main').id).toBe('main');
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Site' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Skip to content' })[0]).toHaveProperty('hash', '#main');
    // the state's one primary action is a real link
    const primary = screen.getAllByRole('link', { name: new RegExp(`^${data.content.primary.label}`) });
    expect(primary.length).toBeGreaterThan(0);
    // unknown facts are typed placeholders, never prose
    expect(container.textContent).toContain('TODO(Tyler & Sara)');
    unmount();
  });

  it('hides the countdown on the wedding day and shows it in TEASER', () => {
    const teaser = render(<>{t.recipes.home(homeData(theme, 'TEASER'))}</>);
    expect(teaser.container.querySelector('.gh-countdown, .cv-sky')).not.toBeNull();
    teaser.unmount();
    const today = render(<>{t.recipes.home(homeData(theme, 'WEDDING_DAY'))}</>);
    expect(today.container.querySelector('.gh-countdown, .cv-sky')).toBeNull();
    expect(today.container.querySelector('#now')).not.toBeNull();
    today.unmount();
  });

  it('RSVP_OPEN leads with RSVP and never puts Gifts above it', () => {
    const { container, unmount } = render(<>{t.recipes.home(homeData(theme, 'RSVP_OPEN'))}</>);
    const main = screen.getByRole('main');
    const rsvp = within(main).getAllByRole('link', { name: /^RSVP/ });
    expect(rsvp[0]?.getAttribute('href')).toBe('/rsvp');
    const html = container.innerHTML;
    expect(html.indexOf('/rsvp')).toBeLessThan(html.indexOf('/gifts'));
    unmount();
  });
});

describe('the two themes are structurally different', () => {
  it('Gilded Hour numbers its acts on one axis with an elevator panel; Conservatory mounts pressed cards on a tag rail', () => {
    const gh = render(<>{getTheme('gilded-hour').recipes.home(homeData('gilded-hour', 'TEASER'))}</>);
    expect(gh.container.querySelectorAll('.gh-plaque--act').length).toBe(5);
    expect(gh.container.querySelector('.gh-panel')).not.toBeNull();
    expect(gh.container.querySelector('.gh-frieze')).not.toBeNull();
    expect(gh.container.querySelector('[class^="cv-"], [class*=" cv-"]')).toBeNull();
    gh.unmount();
    const cv = render(<>{getTheme('conservatory').recipes.home(homeData('conservatory', 'TEASER'))}</>);
    expect(cv.container.querySelector('.cv-rail')).not.toBeNull();
    expect(cv.container.querySelectorAll('.cv-pressed').length).toBeGreaterThan(0);
    expect(cv.container.querySelector('.cv-plaque, .gh-plaque--act, .gh-panel')).toBeNull();
    expect(cv.container.querySelector('[class^="gh-"], [class*=" gh-"]')).toBeNull();
    cv.unmount();
  });
});
