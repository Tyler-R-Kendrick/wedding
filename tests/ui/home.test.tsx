import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LIFECYCLE_MODE, LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';
import { SEED_SITE } from '@/db/seed/seed';
import { countdownView } from '@/domain/lifecycle/countdown';
import { toSiteFacts } from '@/domain/lifecycle/facts';
import { currentGuestAction } from '@/domain/lifecycle/guest-actions';
import { navFor } from '@/domain/lifecycle/nav';
import { getTheme } from '@/themes';
import { THEME_IDS } from '@/themes/registry';
import { homeContent } from '@/themes/shared/home-content';
import type { HomeData, PublicSiteFacts, ThemeId, WeddingDetails } from '@/themes/types';

const NOW = new Date('2026-09-05T12:00:00Z');
/** Everything the site knows. Only `site` below, the two names, reaches a signed-out reader's Home. */
const full = toSiteFacts({ ...SEED_SITE });
const site: PublicSiteFacts = { coupleDisplayName: full.coupleDisplayName, partner1: full.partner1, partner2: full.partner2 };
const details: WeddingDetails = { date: full.date, venue: full.venue, countdown: countdownView(NOW) };

/** Home as `renderHome` builds it for a reader who is not signed in (themes/server.tsx). */
function homeData(theme: ThemeId, state: LifecycleState): HomeData {
  return {
    theme,
    site,
    details: null,
    lifecycle: { state, mode: LIFECYCLE_MODE[state], persistedState: state, preview: null, suggested: 'RSVP_OPEN', publishedAt: null, note: null },
    // The frame hands the navigation the venue whoever is reading; signed out, nothing may come of it.
    nav: navFor(state, { venue: full.venue, currentPath: '/', signedIn: false }),
    switcherEnabled: false,
    content: homeContent(site, state),
  };
}

/** When and where the wedding is, in every form a page prints it. */
const WEDDING_DETAILS = [
  full.date.long,
  full.date.motif,
  full.date.iso,
  full.date.weekday,
  'July',
  '2027',
  full.venue.name,
  'Athletic Association',
  full.venue.address,
  'Michigan Ave',
  '60603',
  full.venue.city,
  'chicagoathletichotel',
  'google.com/maps',
];

/**
 * A photograph's description may say where the picture was taken: Sara and Tyler live in Chicago,
 * and Our Adventures, which anyone may read, is full of it. It may not say the wedding is there. So
 * the city is checked everywhere except an image's `alt`; the venue, the address and the date are
 * checked there too.
 */
const exceptAltText = (html: string) => html.replace(/\salt="[^"]*"/g, '');
function expectNoWeddingDetails(html: string, where: string) {
  for (const detail of WEDDING_DETAILS) {
    if (detail === full.venue.city) expect(exceptAltText(html), `${where}: "${detail}" outside a photo description`).not.toContain(detail);
    else expect(html, `${where}: "${detail}"`).not.toContain(detail);
  }
}

/** Where a link on a signed-out page may lead: the couple's pages, the legal pages, and the way in. */
const PUBLIC_HREFS = ['/', '/our-story', '/our-adventures', '/credits', '/privacy', '/terms', '/sign-in', '#main'];

describe.each(THEME_IDS)('Home recipe (%s)', (theme) => {
  const t = getTheme(theme);

  it.each(LIFECYCLE_STATES)('%s: the couple’s names, the primary action through sign-in, landmarks', (state) => {
    const data = homeData(theme, state);
    const { container, unmount } = render(<>{t.recipes.home(data)}</>);
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    // The names on every day, the wedding day included.
    expect(h1[0]!.textContent?.replace(/\s+/g, ' ').trim()).toBe('Sara + Tyler');
    expect(container.querySelector(`[data-theme="${theme}"]`)).not.toBeNull();
    expect(screen.getByRole('main').id).toBe('main');
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Site' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Skip to content' })[0]).toHaveProperty('hash', '#main');
    // The state's one primary action is a real link, and it goes through the sign-in door to the
    // page the dashboard opens with.
    const action = currentGuestAction(state);
    const primary = within(screen.getByRole('main')).getAllByRole('link', { name: new RegExp(`^${action.label}`) });
    expect(primary.length).toBeGreaterThan(0);
    for (const link of primary) expect(link.getAttribute('href')).toBe(`/sign-in?next=${encodeURIComponent(action.href)}`);
    expect(within(screen.getByRole('main')).getAllByRole('link', { name: /^Our Story/ })[0]?.getAttribute('href')).toBe('/our-story');
    // Nothing on the page is unwritten, and no authoring marker reaches a visitor.
    expect(container.querySelector('.todo, [data-placeholder="true"]')).toBeNull();
    expect(container.textContent).not.toContain('TODO(');
    unmount();
  });

  it.each(LIFECYCLE_STATES)('%s: says nothing about when or where the wedding is, in the page or its shell', (state) => {
    const { container, unmount } = render(<>{t.recipes.home(homeData(theme, state))}</>);
    // The whole document as rendered: text, attributes (alt text, hrefs, datetimes, labels) and all.
    expectNoWeddingDetails(container.innerHTML, `${theme} ${state}`);
    // The shell (masthead, navigation, footer) names nothing at all, photo descriptions included.
    for (const part of container.querySelectorAll('header, nav, footer')) {
      for (const detail of WEDDING_DETAILS) expect(part.outerHTML, `${theme} ${state} <${part.tagName.toLowerCase()}>: "${detail}"`).not.toContain(detail);
    }
    // No date element, no countdown, no schedule, no map, no directions.
    expect(container.querySelector('time')).toBeNull();
    expect(container.querySelector('.gh-countdown, .cv-sky, .bd-countdown, [class*="countdown"]')).toBeNull();
    expect(container.querySelector('#now, #schedule, #the-wedding, .bd-schedule, [class*="timeline"], [class*="schedule"]')).toBeNull();
    expect(container.querySelector('iframe, [class*="map"], [data-map]')).toBeNull();
    expect(container.textContent).not.toMatch(/Directions|days? to go|Ceremony|Cocktail hour|Reception/);
    // Every link stays on the public pages or goes through sign-in. None leaves the site.
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(4);
    for (const href of hrefs) {
      if (href.startsWith('/sign-in?next=')) continue;
      expect(PUBLIC_HREFS, `${theme} ${state}: ${href}`).toContain(href);
    }
    // Printed pages list the site's addresses in the footer only for a signed-in reader.
    expect(container.textContent).not.toMatch(/kendrick\.wedding\/(guests|our-venue|rsvp|travel)/);
    unmount();
  });

  it('prints the date and the venue in its shell only once the frame carries them, which is only when signed in', () => {
    const signedOut = render(<>{t.recipes.home(homeData(theme, 'RSVP_CLOSED'))}</>);
    for (const detail of WEDDING_DETAILS) expect(signedOut.getByRole('contentinfo').innerHTML, `"${detail}"`).not.toContain(detail);
    expect(signedOut.getByRole('contentinfo').querySelector('a[href^="http"]')).toBeNull();
    signedOut.unmount();
    // An administrator looking at Home is signed in: the same shell, handed the details, prints them.
    const signedIn = render(<>{t.recipes.home({ ...homeData(theme, 'RSVP_CLOSED'), details, nav: navFor('RSVP_CLOSED', { venue: full.venue, currentPath: '/', signedIn: true, admin: true }) })}</>);
    const footer = signedIn.getByRole('contentinfo').textContent ?? '';
    // Each design sets the date its own way: in full, or as the 07 · 17 · 27 motif.
    expect(footer.includes(full.date.long) || footer.includes(full.date.motif)).toBe(true);
    expect(footer).toContain(full.venue.name);
    // ... and still not in the page body, whose model never had them.
    expectNoWeddingDetails(signedIn.getByRole('main').innerHTML, `${theme} signed in, page body`);
    signedIn.unmount();
  });

  it('RSVP_OPEN leads with RSVP, in the accent, and offers no gift link above it or at all', () => {
    const { unmount } = render(<>{t.recipes.home(homeData(theme, 'RSVP_OPEN'))}</>);
    const main = screen.getByRole('main');
    const rsvp = within(main).getAllByRole('link', { name: /^RSVP/ });
    // Through the sign-in door: /sign-in sends a guest who is already signed in straight on to it.
    expect(rsvp[0]?.getAttribute('href')).toBe('/sign-in?next=%2Frsvp');
    const hrefs = within(main).getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    // The RSVP is the first sign-in link on the page.
    expect(hrefs.find((h) => h.startsWith('/sign-in'))).toBe('/sign-in?next=%2Frsvp');
    expect(hrefs.some((h) => h.includes('gifts'))).toBe(false);
    // No link in the page body goes to a guest page directly.
    const direct = hrefs.filter((h) => /^\/(guests|rsvp|your-weekend|transportation|trip|gifts|photos|our-venue|travel|the-wedding|ask-us|share-an-adventure)(\/|$|\?|#)/.test(h));
    expect(direct).toEqual([]);
    unmount();
  });
});

describe('the approved design has its own structure', () => {
  it('Botanical–Deco opens on the couple and the door, then the theme, the two things anyone may read, and the door again', () => {
    const bd = render(<>{getTheme('botanical-deco').recipes.home(homeData('botanical-deco', 'TEASER'))}</>);
    // The portrait, not flowers, carries the page: a real <picture> with the formal crop and a phone crop.
    const hero = bd.container.querySelector('.bd-hero') as HTMLElement;
    expect(hero.querySelector('picture[data-media="couple.hero.formal"] source[media]')).not.toBeNull();
    expect(within(hero).getByText('We are getting married')).toBeTruthy();
    // The opening carries the two actions and how a guest gets in. No day count: it would say when.
    expect(within(hero).getAllByRole('link').map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Book your hotel room', '/sign-in?next=%2Fguests%2Ftravel'],
      ['Our Story', '/our-story'],
    ]);
    // How to get in is said once, at the foot of the page.
    expect(hero.querySelector('.bd-hero__note')).toBeNull();
    expect(hero.querySelector('.bd-countdown, .bd-countdown--hero')).toBeNull();
    // The carved-words column that cut the portrait off is gone, and so are its words.
    expect(bd.container.textContent).not.toMatch(/beautiful places|great love/i);
    // The theme, as three words, and the two things anyone may read: the story and the adventures.
    const theme = bd.container.querySelector('.bd-theme') as HTMLElement;
    expect([...theme.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Love', 'Peace', 'Happiness']);
    expect([...bd.container.querySelectorAll('.bd-share__item')].map((el) => el.id)).toEqual(['our-story', 'adventures']);
    expect(bd.container.querySelector('.bd-schedule')).toBeNull();
    // The door once more at the foot of the page, with the same action as the hero.
    const closing = bd.container.querySelector('.bd-closing') as HTMLElement;
    expect(within(closing).getByRole('heading', { level: 2 }).textContent).toBe('Everything for the weekend is inside');
    expect(within(closing).getByRole('link', { name: /^Book your hotel room/ }).getAttribute('href')).toBe('/sign-in?next=%2Fguests%2Ftravel');
    // The retired lakefront crop is not used anywhere.
    expect(bd.container.querySelector('picture[data-media="couple.lakefront"]')).toBeNull();
    // No generated years, no college days, no Sarah.
    expect(bd.container.textContent).not.toMatch(/college|\b20(17|18|20|22|24)\b|Sarah/);
    // Decoration is decoration: botanicals are hidden from assistive technology.
    for (const img of bd.container.querySelectorAll('img.bd-bloom')) expect(img.getAttribute('alt')).toBe('');
    expect(bd.container.querySelector('.gh-plaque--act, .cv-pressed, .gh-panel, .cv-rail')).toBeNull();
    bd.unmount();
  });
});

describe('the two earlier proposals are structurally different', () => {
  it('Gilded Hour numbers its acts on one axis with an elevator panel; Conservatory hangs kraft tags on a tag rail', () => {
    const gh = render(<>{getTheme('gilded-hour').recipes.home(homeData('gilded-hour', 'TEASER'))}</>);
    expect(gh.container.querySelectorAll('.gh-plaque--act').length).toBe(3);
    expect(gh.container.querySelector('.gh-panel')).not.toBeNull();
    expect(gh.container.querySelector('.gh-frieze')).not.toBeNull();
    expect(gh.container.querySelector('[class^="cv-"], [class*=" cv-"]')).toBeNull();
    gh.unmount();
    const cv = render(<>{getTheme('conservatory').recipes.home(homeData('conservatory', 'TEASER'))}</>);
    expect(cv.container.querySelector('.cv-rail')).not.toBeNull();
    // The pressed cards held the facts and the schedule. Home has neither now, so it has none.
    expect(cv.container.querySelector('.cv-pressed')).toBeNull();
    // Every section hangs its link as a tag: the story, the adventures, and the door.
    expect([...cv.container.querySelectorAll('.cv-tag--hang')].map((a) => a.getAttribute('href'))).toEqual(['/our-story', '/our-adventures', '/sign-in?next=%2Fguests%2Ftravel']);
    expect(cv.container.querySelector('.cv-plaque, .gh-plaque--act, .gh-panel')).toBeNull();
    expect(cv.container.querySelector('[class^="gh-"], [class*=" gh-"]')).toBeNull();
    cv.unmount();
  });
});
