import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { SEED_SITE } from '@/db/seed/seed';
import { toSiteFacts } from '@/domain/lifecycle/facts';
import { homeContent } from '@/themes/shared/home-content';
import { copyHasPlaceholder } from '@/themes/shared/copy';

const site = toSiteFacts({ ...SEED_SITE });

describe('home content by lifecycle state', () => {
  it.each(LIFECYCLE_STATES)('%s has a title, one primary action, and 4–6 sections with unique ids', (state) => {
    const c = homeContent(site, state);
    expect(c.title).toBe(state === 'WEDDING_DAY' ? 'Today' : 'Sara + Tyler');
    expect(c.primary.href).toMatch(/^(\/|#)/);
    expect(c.sections.length).toBeGreaterThanOrEqual(4);
    expect(c.sections.length).toBeLessThanOrEqual(6);
    expect(new Set(c.sections.map((s) => s.id)).size).toBe(c.sections.length);
  });

  it('never states an unsettled fact as prose', () => {
    const rsvp = homeContent(site, 'RSVP_OPEN');
    expect(copyHasPlaceholder(rsvp.deadline)).toBe(true);
    const wedding = rsvp.sections.find((s) => s.id === 'the-wedding');
    expect(wedding?.facts?.some((f) => f.label === 'Dress code' && f.placeholder)).toBe(true);
    const today = homeContent(site, 'WEDDING_DAY').sections.find((s) => s.id === 'now');
    expect(today?.timeline?.every((e) => e.placeholder && !e.start && !e.place)).toBe(true);
    const all = JSON.stringify(LIFECYCLE_STATES.map((s) => homeContent(site, s)));
    for (const invented of ['White City', 'Cindy', 'shuttle', '4:00', 'ORD', 'MDW', 'cocktail attire', 'black tie']) expect(all).not.toContain(invented);
  });

  it('follows the state machine: explore → act → operate → remember', () => {
    expect(homeContent(site, 'TEASER').sections.map((s) => s.act)).toEqual(['adventure', 'place', 'memory', 'hospitality', 'future']);
    expect(homeContent(site, 'TEASER').showCountdown).toBe(true);
    expect(homeContent(site, 'RSVP_OPEN').sections[0]?.id).toBe('rsvp');
    expect(homeContent(site, 'RSVP_OPEN').primary).toMatchObject({ href: '/rsvp', variant: 'accent' });
    expect(homeContent(site, 'WEDDING_DAY').primary.href).toBe('#now');
    expect(homeContent(site, 'WEDDING_DAY').showCountdown).toBe(false);
    expect(homeContent(site, 'POST_WEDDING').primary.href).toBe('/photos');
    expect(homeContent(site, 'ARCHIVE').showCountdown).toBe(false);
  });
});
